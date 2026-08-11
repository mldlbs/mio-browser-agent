const $ = (id) => document.getElementById(id);

let runtime = null;
let currentTask = null;
let planCollapsed = false;
let planProgress = { steps: [], done: [], failed: [], replanned: false };
let _historyPage = 0;
let expandedFailureStep = null;

function resetPlanProgress() {
  planProgress = { steps: [], done: [], failed: [], replanned: false };
}

function renderPlanPanel() {
  const panel = $("planPanel");
  if (!planProgress.steps.length) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  panel.classList.toggle("collapsed", planCollapsed);
  panel.innerHTML = "";
  const head = document.createElement("div");
  head.className = "plan-head";
  const title = document.createElement("span");
  title.textContent = "执行计划" + (planProgress.replanned ? "（已重规划）" : "");
  head.appendChild(title);
  const toggle = document.createElement("button");
  toggle.className = "plan-toggle";
  toggle.title = planCollapsed ? "展开计划" : "收起计划";
  toggle.textContent = planCollapsed ? "▸" : "▾";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    planCollapsed = !planCollapsed;
    renderPlanPanel();
  });
  head.appendChild(toggle);
  panel.appendChild(head);
  if (planCollapsed) return;
  const list = document.createElement("div");
  list.className = "plan-steps";
  planProgress.steps.forEach((desc, i) => {
    const row = document.createElement("div");
    const cls = planProgress.failed.includes(i) ? " failed"
      : planProgress.done.includes(i) ? " done"
      : i === planProgress.current ? " running"
      : "";
    row.className = "plan-step" + cls;
    if (planProgress.failed.includes(i)) {
      row.addEventListener("click", () => {
        expandedFailureStep = expandedFailureStep === i ? null : i;
        renderPlanPanel();
      });
    }
    const num = document.createElement("span");
    num.className = "plan-num";
    num.textContent = planProgress.done.includes(i) ? "✓"
      : planProgress.failed.includes(i) ? "✗"
      : i === planProgress.current ? "▶"
      : String(i + 1);
    const label = document.createElement("span");
    label.className = "plan-label";
    label.textContent = desc;
    row.appendChild(num);
    row.appendChild(label);
    list.appendChild(row);
    if (planProgress.failed.includes(i) && expandedFailureStep === i) {
      const detail = document.createElement("div");
      detail.className = "step-failure-detail";
      const events = (currentTask && currentTask.stepEvents || []).filter((e) =>
        e.type === "recovery" && e.stepIndex === i
      );
      const narrative = events.length
        ? RecoveryEventsModule.renderStepFailure(events)
        : "无恢复记录";
      detail.textContent = narrative;
      list.appendChild(detail);
    }
  });
  panel.appendChild(list);
}

function appendLog(tag, text) {
  const log = $("log");
  const div = document.createElement("div");
  div.className = "log-line t-" + (tag || "ui");
  const tagEl = document.createElement("span");
  tagEl.className = "tag";
  tagEl.textContent = tag ? tag + ":" : "";
  div.appendChild(tagEl);
  div.appendChild(document.createTextNode(text));
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function renderLogLine(container, tag, text) {
  const div = document.createElement("div");
  div.className = "log-line t-" + (tag || "ui");
  const tagEl = document.createElement("span");
  tagEl.className = "tag";
  tagEl.textContent = tag ? tag + ":" : "";
  div.appendChild(tagEl);
  div.appendChild(document.createTextNode(text));
  container.appendChild(div);
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.getMonth() + 1 + "-" + d.getDate() + " " +
    String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function setStatus(state, cls) {
  const box = $("statusBox");
  const label = $("status");
  if (label) label.textContent = state;
  if (box) {
    box.className = "status-pill " + (cls || (state === "running" || state === "planning" ? "running" : state === "done" ? "done" : state === "error" ? "error" : ""));
  }
}

function toast(msg) {
  appendLog("ui", msg);
}

// Render the one-click task templates above the goal box. Clicking a template
// fills the goal textarea with its (placeholder) text.
function renderTemplates() {
  const host = $("composeTemplates");
  if (!host) return;
  const tmpls = (globalThis.TemplatesModule && TemplatesModule.TEMPLATES) || [];
  host.innerHTML = "";
  for (const t of tmpls) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "template-chip";
    chip.textContent = t.label;
    chip.title = t.hint || "";
    chip.addEventListener("click", () => {
      const box = $("goal");
      box.value = t.goal;
      box.focus();
      box.setSelectionRange(0, 0);
    });
    host.appendChild(chip);
  }
}

async function init() {
  const verEl = $("version");
  if (verEl && globalThis.chrome && chrome.runtime && chrome.runtime.getManifest) {
    verEl.textContent = "v" + (chrome.runtime.getManifest().version || "");
  }
  renderTemplates();
  const s = await getSettings();
  $("provider").value = s.provider;
  $("model").value = s.model;
  $("baseUrl").value = s.baseURL;
  $("apiKey").value = s.apiKey;
  $("maxSteps").value = s.maxSteps;
  $("enableVision").checked = !!s.enableVision;
  const v = s.vision || {};
  $("visionModel").value = v.model || "";
  $("visionBaseUrl").value = v.baseURL || "https://open.bigmodel.cn/api/paas/v4";
  $("visionApiKey").value = v.apiKey || "";
  const sync = s.sync || {};
  $("syncEnabled").checked = !!sync.enabled;
  $("syncServer").value = sync.serverUrl || "";
  $("syncApiKey").value = sync.apiKey || "";
  if (sync.lastSyncAt) $("syncStatus").textContent = "上次同步: " + new Date(sync.lastSyncAt).toLocaleString();

  $("saveSettings").addEventListener("click", async () => {
    await setSettings({
      provider: $("provider").value.trim() || "openai",
      model: $("model").value.trim() || "gpt-4o-mini",
      baseURL: $("baseUrl").value.trim() || "https://api.openai.com/v1",
      apiKey: $("apiKey").value.trim(),
      maxSteps: parseInt($("maxSteps").value, 10) || 30,
      enableVision: !!$("enableVision").checked,
      vision: {
        provider: "openai",
        model: $("visionModel").value.trim(),
        baseURL: $("visionBaseUrl").value.trim() || "https://open.bigmodel.cn/api/paas/v4",
        apiKey: $("visionApiKey").value.trim(),
      },
      sync: {
        enabled: !!$("syncEnabled").checked,
        serverUrl: $("syncServer").value.trim(),
        apiKey: $("syncApiKey").value.trim(),
        lastSyncAt: (await getSettings()).sync && (await getSettings()).sync.lastSyncAt || 0,
      },
    });
    toast("设置已保存");
  });

  $("syncTest").addEventListener("click", async () => {
    const url = $("syncServer").value.trim();
    if (!url) return toast("请先填同步服务器地址");
    try {
      const r = await fetch(url.replace(/\/+$/, "") + "/v1/health");
      toast(r.ok ? "连接成功" : "连接失败 (HTTP " + r.status + ")");
    } catch (_) { toast("无法连接服务器"); }
  });
  $("syncNow").addEventListener("click", async () => {
    const url = $("syncServer").value.trim();
    const key = $("syncApiKey").value.trim();
    if (!url || !key) return toast("请先填服务器地址和 API Key");
    try {
      const hist = await HistoryModule.getHistory();
      const res = await SyncClient.syncHistory(url, key, hist);
      if (res.merged && HistoryModule._setRawHistory) await HistoryModule._setRawHistory(res.merged);
      const st = await getSettings();
      st.sync.lastSyncAt = Date.now();
      await setSettings(st);
      $("syncStatus").textContent = "已同步 · 拉取 " + res.pulled + " · 上传 " + res.pushed + (res.pushFailed ? " · 上传失败 " + res.pushFailed : "") + " · 失败 " + res.failed.length;
      toast("同步完成");
    } catch (e) {
      const msg = e && e.status === 401 ? "API Key 错误" : (e && e.status === 404 ? "服务器未就绪" : "无法连接服务器");
      toast("同步失败: " + msg);
    }
  });

  $("start").addEventListener("click", startTask);
  $("stop").addEventListener("click", () => { if (runtime) runtime.stop(); });
  $("historyToggle").addEventListener("click", toggleHistory);
  $("historyClose").addEventListener("click", toggleHistory);
  $("historyClear").addEventListener("click", clearHistory);                                                
  $("historyExport").addEventListener("click", exportHistory);                                              
  $("historyImport").addEventListener("click", importHistory);                                             
  $("historySearch").addEventListener("input", () => { _historyPage = 0; renderHistory(); });
  $("historyPrev").addEventListener("click", () => { if (_historyPage > 0) { _historyPage--; renderHistory(); } });
  $("historyNext").addEventListener("click", () => { _historyPage++; renderHistory(); });
  $("collapsePanel").addEventListener("click", async () => {
    if (currentTask) await runtime && runtime.stop();
    try {
      await chrome.sidePanel.close({ windowId: chrome.windows.WINDOW_ID_CURRENT });
    } catch (_) {
      // Chrome < 141 has no sidePanel.close; fall back to window.close().
      try { window.close(); } catch (_) {}
    }
  });
}

function toggleHistory() {
  const view = $("historyView");
  const showing = view.classList.toggle("open");
  const log = $("log");
  const plan = $("planPanel");
  if (showing) {
    // History list and log/plan panels are both flex:1 — hide the panels while
    // browsing history so the list gets the full height and its own scrollbar.
    log.style.display = "none";
    if (plan.style.display !== "none") {
      plan.dataset.prevDisplay = plan.style.display || "";
    }
    plan.style.display = "none";
    renderHistory();
  } else {
    log.style.display = "";
    plan.style.display = plan.dataset.prevDisplay || "none";
    delete plan.dataset.prevDisplay;
  }
}

async function clearHistory() {
  _historyPage = 0;
  await HistoryModule.clearHistory();
  renderHistory();
  appendLog("ui", "历史记录已清空");
}

async function exportHistory() {
  const records = await HistoryModule.getHistory();
  if (!records.length) { toast("没有可导出的历史记录"); return; }
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mio-history-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(url);
  toast("已导出 " + records.length + " 条记录");
}

async function importHistory() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      const merged = await HistoryModule.importRecords(raw);
      _historyPage = 0;
      renderHistory();
      toast("已导入 " + (merged.length ? "记录" : "") + "，共 " + merged.length + " 条");
    } catch (e) {
      toast("导入失败: " + ((e && e.message) || String(e)));
    }
  };
  input.click();
}

// Export a single task as a shareable JSON: goal, plan steps, summary, and the
// recovery/step log. Deliberately excludes resume (checkpoint/notes) so no
// credentials or partial state leak; the receiver can only see what happened.
function exportOneHistory(r) {
  const share = HistoryModule.buildShareRecord(r);
  const blob = new Blob([JSON.stringify(share, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mio-task-" + (r.id || "share").slice(0, 12) + ".json";
  a.click();
  URL.revokeObjectURL(url);
  toast("已导出单条任务");
}

async function historyLog(goal) {
  if (!currentTask) return;
  currentTask.logs.push({ tag: "debug", text: "目标: " + goal, ts: Date.now() });
  await HistoryModule.addHistoryRecord(currentTask);
  const st = await getSettings();
  if (st.sync && st.sync.enabled && st.sync.serverUrl && st.sync.apiKey) {
    try {
      const res = await SyncClient.syncHistory(st.sync.serverUrl, st.sync.apiKey, await HistoryModule.getHistory());
      if (res.merged && HistoryModule._setRawHistory) await HistoryModule._setRawHistory(res.merged);
      st.sync.lastSyncAt = Date.now();
      await setSettings(st);
    } catch (_) { /* 静默，不打断任务完成 */ }
  }
  currentTask = null;
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  const q = $("historySearch").value || "";
  HistoryModule.getHistory().then((records) => {
    const filtered = HistoryModule.filterRecords(records, q);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = q ? "没有匹配的记录" : "暂无历史记录";
      list.appendChild(empty);
      updateHistoryPager(0, 1);
      return;
    }
    const perPage = 10;
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    if (_historyPage >= totalPages) _historyPage = totalPages - 1;
    if (_historyPage < 0) _historyPage = 0;
    const pageRecords = filtered.slice(_historyPage * perPage, (_historyPage + 1) * perPage);
    for (const r of pageRecords) {
      const item = document.createElement("div");
      item.className = "history-item s-" + r.status + (r.pinned ? " pinned" : "");
      const head = document.createElement("div");
      head.className = "history-item-head";
      const info = document.createElement("div");
      info.className = "history-item-info";
      const goalEl = document.createElement("div");
      goalEl.className = "history-goal";
      goalEl.textContent = (r.pinned ? "★ " : "") + r.goal;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = formatTime(r.startedAt) + " · " +
        (r.status === "done" ? "完成" : r.status === "error" ? "出错" : r.status) +
        (r.recoveries || r.replans ? " · 恢复 " + r.recoveries + "/重规划 " + r.replans : "");
      info.appendChild(goalEl);
      info.appendChild(meta);
      const pinBtn = document.createElement("button");
      pinBtn.className = "history-pin";
      pinBtn.textContent = r.pinned ? "★" : "☆";
      pinBtn.title = r.pinned ? "取消收藏" : "收藏";
      pinBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await HistoryModule.updateHistoryRecord(r.id, { pinned: !r.pinned });
        renderHistory();
      });
      head.appendChild(pinBtn);
      head.appendChild(info);
      const actions = document.createElement("div");
      actions.className = "history-item-actions";
      if (r.resume) {
        const resumeBtn = document.createElement("button");
        resumeBtn.className = "history-resume";
        resumeBtn.textContent = "继续";
        resumeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleHistory();
          startTask(r.resume);
        });
        actions.appendChild(resumeBtn);
      }
      const replayBtn = document.createElement("button");
      replayBtn.className = "history-replay";
      replayBtn.textContent = "重跑";
      replayBtn.title = "重新执行该任务";
      replayBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHistory();
        startTask({ goal: r.goal });
      });
      actions.appendChild(replayBtn);
      const shareBtn = document.createElement("button");
      shareBtn.className = "history-share";
      shareBtn.textContent = "分享";
      shareBtn.title = "导出单条任务为分享 JSON（不含凭据/恢复令牌）";
      shareBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        exportOneHistory(r);
      });
      actions.appendChild(shareBtn);
      const badge = document.createElement("span");
      badge.className = "history-status";
      badge.textContent = r.status;
      actions.appendChild(badge);
      head.appendChild(actions);
      const body = document.createElement("div");
      body.className = "history-item-body";
      if (r.summary) {
        const sum = document.createElement("div");
        sum.className = "history-summary";
        sum.textContent = r.summary;
        body.appendChild(sum);
      }
      if (r.tags && r.tags.length) {
        const tags = document.createElement("div");
        tags.className = "history-tags";
        for (const t of r.tags) {
          const tagEl = document.createElement("span");
          tagEl.className = "history-tag";
          tagEl.textContent = "#" + t;
          tags.appendChild(tagEl);
        }
        body.appendChild(tags);
      }
      const logsWrap = document.createElement("div");
      logsWrap.className = "history-logs";
      body.appendChild(logsWrap);
      item.appendChild(head);
      item.appendChild(body);
      head.addEventListener("click", () => {
        const open = item.classList.toggle("open");
        if (open) {
          logsWrap.innerHTML = "";
          for (const l of r.logs) renderLogLine(logsWrap, l.tag, l.text);
          logsWrap.scrollTop = logsWrap.scrollHeight;
        }
      });
      const tagAdd = document.createElement("span");
      tagAdd.className = "history-tag-add";
      tagAdd.textContent = "+ 标签";
      tagAdd.addEventListener("click", async (e) => {
        e.stopPropagation();
        const input = (globalThis.prompt && prompt("输入标签，逗号分隔（可清空移除）", (r.tags || []).join(", ")));
        if (input === null) return;
        const tags = input.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
        await HistoryModule.updateHistoryRecord(r.id, { tags });
        renderHistory();
      });
      if (!body.querySelector(".history-tags")) {
        const tags = document.createElement("div");
        tags.className = "history-tags";
        tags.appendChild(tagAdd);
        body.insertBefore(tags, logsWrap);
      } else {
        body.querySelector(".history-tags").appendChild(tagAdd);
      }
      list.appendChild(item);
    }
    updateHistoryPager(filtered.length, totalPages);
  });
}

function updateHistoryPager(total, totalPages) {
  const pager = $("historyPager");
  if (!pager) return;
  pager.hidden = total <= 10;
  $("historyPrev").disabled = _historyPage <= 0;
  $("historyNext").disabled = _historyPage >= totalPages - 1;
  $("historyPageInfo").textContent = (_historyPage + 1) + " / " + totalPages + "（共 " + total + " 条）";
}

async function startTask(resume) {
  if ($("start").disabled) return;
  const goal = resume && resume.goal ? resume.goal : $("goal").value.trim();
  if (!goal) { toast("请输入任务目标"); return; }
  if (resume) $("goal").value = goal;
  const settings = {
    provider: $("provider").value.trim() || "openai",
    model: $("model").value.trim() || "gpt-4o-mini",
    baseURL: $("baseUrl").value.trim() || "https://api.openai.com/v1",
    apiKey: $("apiKey").value.trim(),
    maxSteps: parseInt($("maxSteps").value, 10) || 30,
    enableVision: !!$("enableVision").checked,
    vision: {
      provider: "openai",
      model: $("visionModel").value.trim(),
      baseURL: $("visionBaseUrl").value.trim() || "https://open.bigmodel.cn/api/paas/v4",
      apiKey: $("visionApiKey").value.trim(),
    },
  };
  const prev = await getSettings();
  settings.sync = prev.sync || {};
  await setSettings(settings);
  if (!settings.apiKey) { toast("请先保存 API Key"); $("apiKey").focus(); return; }

  $("log").innerHTML = "";
  appendLog("user", goal);
  setStatus("planning", "running");
  $("start").disabled = true;
  resetPlanProgress();
  renderPlanPanel();

  currentTask = {
    id: Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    goal,
    status: "running",
    summary: "",
    startedAt: Date.now(),
    finishedAt: 0,
    recoveries: 0,
    replans: 0,
    logs: [],
    recoveryEvents: RecoveryEventsModule.startEvents(),
    resume: resume || null,
  };

  runtime = createAgentRuntime({
    settings,
    bridge: createPageBridge(),
    onLog: (tag, text) => {
      appendLog(tag, text);
      if (currentTask) {
        currentTask.logs.push({ tag, text, ts: Date.now() });
        if (tag === "result") currentTask.summary = text;
      }
    },
    onRecovery: (ev) => {
      if (!currentTask) return;
      currentTask.recoveryEvents = RecoveryEventsModule.addEvent(currentTask.recoveryEvents, ev);
      if (ev.kind === "error") {
        const stepNum = typeof ev.stepId === "number" && isFinite(ev.stepId) ? ev.stepId + 1 : ev.stepId;
        appendLog("recover", `步骤 ${stepNum} ❌ ${ev.code}${ev.message ? ": " + ev.message : ""}`);
      } else if (ev.kind === "outcome" && ev.outcome === "exhausted") {
        appendLog("recover", "✗ 恢复用尽，步骤失败（点击计划面板失败步骤查看详情）");
      }
    },
    onCheckpoint: (cp) => { if (currentTask) currentTask.resume = cp; },
    onProgress: (p) => {
      if (!currentTask) return;
      if (p.status === "replanned") {
        planProgress.replanned = true;
        planProgress.done = [];
        planProgress.failed = [];
        planProgress.current = 0;
        planProgress.steps = p.steps;
      } else if (p.status === "done") {
        planProgress.steps = p.steps;
        planProgress.done.push(p.currentIndex);
        planProgress.current = p.currentIndex + 1;
      } else if (p.status === "failed") {
        planProgress.failed.push(p.currentIndex);
        planProgress.current = p.currentIndex;
      } else {
        planProgress.steps = p.steps;
        planProgress.current = p.currentIndex;
      }
      renderPlanPanel();
    },
    onState: (state) => setStatus(state),
    deps: { maxSteps: settings.maxSteps || 30 },
  });

  try {
    const result = await runtime.run(goal, resume);
    currentTask.status = result.ok ? "done" : "error";
    currentTask.stepEvents = (result && result.events) || currentTask.stepEvents || [];
    currentTask.recoveries = currentTask.stepEvents.filter((e) => e.type === "recovery" && e.kind === "error").length;
    currentTask.replans = currentTask.stepEvents.filter((e) => e.type === "replan").length;
    currentTask.finishedAt = Date.now();
    if (!result.ok && result.resume) currentTask.resume = result.resume;
    await historyLog(goal);
    setStatus(currentTask.status, currentTask.status);
  } catch (e) {
    currentTask.status = "error";
    currentTask.summary = e.message || String(e);
    currentTask.finishedAt = Date.now();
    await historyLog(goal);
    appendLog("error", e.message || String(e));
    setStatus("error", "error");
  } finally {
    $("start").disabled = false;
  }
}

init().catch((e) => appendLog("error", "初始化失败: " + (e && e.message || e)));
