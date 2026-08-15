// mio 后台 Service Worker（MV3 经典 worker）。
//
// 职责：
// 1. 通过 chrome.alarms 驱动定时/周期任务（签到/监控/日报自动跑）
// 2. 到点后拉起完整 agent runtime（planner → executor → bridge），在目标标签页执行
// 3. 结果写入历史、更新定时任务状态、badge/消息通知 sidepanel
// 4. 浏览器重启后按存储的定时配置自动重建 alarms（Chrome 持久化）
//
// 全部模块通过 importScripts 以经典脚本方式共享同一全局作用域（同 sidepanel.html
// 的 <script> 顺序），runtime 链本身是 DOM-free 的，可在 worker 中运行。

importScripts(
  "../common/logger.js",
  "../common/protocol.js",
  "../common/storage.js",
  "../common/error-msg.js",
  "../common/fields.js",
  "../common/tool-labels.js",
  "../common/history.js",
  "../common/task-memory.js",
  "../common/scheduler.js",
  "../llm/adapter.js",
  "../llm/openai.js",
  "../llm/anthropic.js",
  "../tools/registry.js",
  "../tools/click.js",
  "../tools/type.js",
  "../tools/scroll.js",
  "../tools/wait.js",
  "../tools/navigate.js",
  "../tools/extract_text.js",
  "../tools/paste.js",
  "../tools/read_captcha.js",
  "../tools/tab.js",
  "../tools/memo.js",
  "../tools/click_at.js",
  "../tools/find_by_vision.js",
  "../tools/form_fill.js",
  "../sidepanel/bridge.js",
  "../sidepanel/planner.js",
  "../sidepanel/memory.js",
  "../sidepanel/notes.js",
  "../sidepanel/recovery-context.js",
  "../sidepanel/recovery-result.js",
  "../sidepanel/recovery-policy.js",
  "../sidepanel/recovery-engine.js",
  "../sidepanel/runtime-protocol.js",
  "../sidepanel/turn-handler.js",
  "../sidepanel/metrics.js",
  "../sidepanel/vision.js",
  "../sidepanel/executor.js",
  "../sidepanel/agent-runtime.js"
);

const S = globalThis.SchedulerModule;

// ── alarms 同步：存储中的定时配置 ⇄ chrome.alarms ──
async function syncAlarms() {
  const schedules = await S.getSchedules();
  const wanted = new Set();
  for (const s of schedules) {
    if (!s.enabled || !s.goal) continue;
    const info = S.scheduleToAlarmInfo(s);
    if (!info) continue;
    const name = S.alarmName(s.id);
    wanted.add(name);
    chrome.alarms.create(name, info);
  }
  // 清理已删除/已停用的残留 alarm
  const all = await chrome.alarms.getAll();
  for (const a of all) {
    if (a.name.startsWith(S.ALARM_PREFIX) && !wanted.has(a.name)) {
      await chrome.alarms.clear(a.name);
    }
  }
}

async function clearAlarmFor(id) {
  await chrome.alarms.clear(S.alarmName(id));
}

// ── 执行定时任务 ──
const running = new Set();

async function findOrCreateTargetTab(url) {
  if (url) {
    const host = globalThis.TaskMemoryModule.extractDomain(url);
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((t) => t.url && globalThis.TaskMemoryModule.extractDomain(t.url) === host);
    if (existing) {
      if (!existing.active) await chrome.tabs.update(existing.id, { active: false });
      return existing;
    }
    const created = await chrome.tabs.create({ url, active: false });
    await waitTabReady(created.id);
    return created;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active) return active;
  throw new Error("没有可执行的标签页（请给定时任务配置目标网址）");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTabReady(tabId, timeoutMs) {
  const start = Date.now();
  const limit = timeoutMs || 25000;
  while (Date.now() - start < limit) {
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === "complete" && t.url && !t.url.startsWith("chrome://")) return t;
    } catch (_) { return null; }
    await sleep(400);
  }
  return null;
}

async function runScheduledTask(id) {
  if (running.has(id)) return;
  running.add(id);
  const heartbeat = setInterval(() => {
    // MV3 SW 空闲约 30s 会被回收；定期做一次廉价扩展 API 调用重置空闲计时器，
    // 保证长任务（多次 LLM 调用）期间 SW 不被杀掉。
    chrome.storage.local.get(S.SCHEDULE_KEY).catch(() => {});
  }, 20000);

  let summary = "";
  let status = "error";
  let tab = null;
  try {
    const [schedule] = (await S.getSchedules()).filter((x) => x.id === id);
    if (!schedule || !schedule.enabled) return;
    const settings = await getSettings();
    if (!settings.apiKey) {
      summary = "未配置 API Key，定时任务无法执行";
      throw new Error(summary);
    }
    tab = await findOrCreateTargetTab(schedule.url);
    const bridge = createPageBridge({ tabId: tab.id });

    let logs = [];
    const runtime = createAgentRuntime({
      settings,
      bridge,
      onLog: (tag, text) => { logs.push({ tag, text, ts: Date.now() }); },
      onState: () => {},
      onRecovery: () => {},
      onCheckpoint: () => {},
      onProgress: () => {},
      onStepEvent: () => {},
      deps: { maxSteps: settings.maxSteps || 30 },
    });

    const result = await runtime.run(schedule.goal);
    status = result.ok ? "done" : "error";
    // 失败时给出小白可读的中文总结（复用 error-msg 人话化）。
    const em = globalThis.ErrorMsgModule || null;
    summary = result.ok
      ? (result.summary || "完成")
      : (em && em.humanizeErrorFull(result.errorCode || "RECOVERY_EXHAUSTED", result.error)) || (result.error || "失败");
    logs.push({ tag: "result", text: summary, ts: Date.now() });

    // 历史记录 + 任务记忆（仅 goal + 域名，本地存储）
    const host = globalThis.TaskMemoryModule.extractDomain((tab && tab.url) || schedule.url);
    await HistoryModule.addHistoryRecord({
      id: "sched_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      goal: schedule.goal,
      status,
      summary,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      recoveries: (result && result.recoveries) || 0,
      replans: (result && result.replans) || 0,
      logs,
    });
    if (host) await TaskMemoryModule.recordGoal(host, schedule.goal);
  } catch (e) {
    status = "error";
    summary = (e && e.message) || String(e);
  } finally {
    clearInterval(heartbeat);
    running.delete(id);
    try {
      await S.setScheduleResult(id, { status, summary });
    } catch (_) {}
    if (tab && !tab.active) { /* 定时任务用的后台标签页保留，供用户查看结果 */ }
    await updateBadge();
    notifySidepanel({ type: "SCHEDULED_RESULT", id, status, summary });
  }
}

function notifySidepanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ── badge：有定时任务失败时显示 ✗ 计数（无需 notifications 权限） ──
async function updateBadge() {
  try {
    const schedules = await S.getSchedules();
    const failed = schedules.filter((s) => s.enabled && s.lastStatus === "error").length;
    if (failed > 0) {
      chrome.action.setBadgeBackgroundColor({ color: "#f38ba8" });
      chrome.action.setBadgeText({ text: String(failed) });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  } catch (_) {}
}

// ── 生命周期 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  syncAlarms().catch(() => {});
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarms().catch(() => {});
  updateBadge();
});

// 用户在 sidepanel 增删改定时任务后，storage 变更触发 alarm 重同步。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[S.SCHEDULE_KEY]) {
    syncAlarms().catch(() => {});
    updateBadge();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mio-keepalive") return;
  if (!alarm.name.startsWith(S.ALARM_PREFIX)) return;
  const id = alarm.name.slice(S.ALARM_PREFIX.length);
  runScheduledTask(id);
});

// sidepanel 手动触发：立即执行 / 强制重建 alarms
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SCHEDULE_RUN_NOW") {
    runScheduledTask(msg.id);
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === "SCHEDULE_SYNC") {
    syncAlarms().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
