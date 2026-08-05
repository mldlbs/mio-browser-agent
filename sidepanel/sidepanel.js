const $ = (id) => document.getElementById(id);

let runtime = null;
let currentTask = null;

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

async function init() {
  const s = await getSettings();
  $("provider").value = s.provider;
  $("model").value = s.model;
  $("baseUrl").value = s.baseURL;
  $("apiKey").value = s.apiKey;
  $("maxSteps").value = s.maxSteps;

  $("saveSettings").addEventListener("click", async () => {
    await setSettings({
      provider: $("provider").value.trim() || "openai",
      model: $("model").value.trim() || "gpt-4o-mini",
      baseURL: $("baseUrl").value.trim() || "https://api.openai.com/v1",
      apiKey: $("apiKey").value.trim(),
      maxSteps: parseInt($("maxSteps").value, 10) || 30,
    });
    toast("设置已保存");
  });

  $("start").addEventListener("click", startTask);
  $("stop").addEventListener("click", () => { if (runtime) runtime.stop(); });
  $("historyToggle").addEventListener("click", toggleHistory);
  $("historyClose").addEventListener("click", toggleHistory);
  $("historyClear").addEventListener("click", clearHistory);
}

function toggleHistory() {
  const view = $("historyView");
  const showing = view.classList.toggle("open");
  if (showing) renderHistory();
}

async function clearHistory() {
  await HistoryModule.clearHistory();
  renderHistory();
  appendLog("ui", "历史记录已清空");
}

async function historyLog(goal) {
  if (!currentTask) return;
  const evRendered = RecoveryEventsModule.renderEventStream(currentTask.recoveryEvents);
  if (evRendered) currentTask.logs.push({ tag: "recover", text: evRendered, ts: Date.now() });
  currentTask.logs.push({ tag: "debug", text: "目标: " + goal, ts: Date.now() });
  await HistoryModule.addHistoryRecord(currentTask);
  currentTask = null;
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  HistoryModule.getHistory().then((records) => {
    if (!records.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "暂无历史记录";
      list.appendChild(empty);
      return;
    }
    for (const r of records) {
      const item = document.createElement("div");
      item.className = "history-item s-" + r.status;
      const head = document.createElement("div");
      head.className = "history-item-head";
      const info = document.createElement("div");
      info.className = "history-item-info";
      const goalEl = document.createElement("div");
      goalEl.className = "history-goal";
      goalEl.textContent = r.goal;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = formatTime(r.startedAt) + " · " +
        (r.status === "done" ? "完成" : r.status === "error" ? "出错" : r.status) +
        (r.recoveries || r.replans ? " · 恢复 " + r.recoveries + "/重规划 " + r.replans : "");
      info.appendChild(goalEl);
      info.appendChild(meta);
      const badge = document.createElement("span");
      badge.className = "history-status";
      badge.textContent = r.status;
      head.appendChild(info);
      head.appendChild(badge);
      const body = document.createElement("div");
      body.className = "history-item-body";
      if (r.summary) {
        const sum = document.createElement("div");
        sum.className = "history-summary";
        sum.textContent = r.summary;
        body.appendChild(sum);
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
      list.appendChild(item);
    }
  });
}

async function startTask() {
  if ($("start").disabled) return;
  const goal = $("goal").value.trim();
  if (!goal) { toast("请输入任务目标"); return; }
  const settings = {
    provider: $("provider").value.trim() || "openai",
    model: $("model").value.trim() || "gpt-4o-mini",
    baseURL: $("baseUrl").value.trim() || "https://api.openai.com/v1",
    apiKey: $("apiKey").value.trim(),
    maxSteps: parseInt($("maxSteps").value, 10) || 30,
  };
  await setSettings(settings);
  if (!settings.apiKey) { toast("请先保存 API Key"); $("apiKey").focus(); return; }

  $("log").innerHTML = "";
  appendLog("user", goal);
  setStatus("planning", "running");
  $("start").disabled = true;

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
      RecoveryEventsModule.addEvent(currentTask.recoveryEvents, ev);
      const rendered = RecoveryEventsModule.renderEventStream(currentTask.recoveryEvents);
      appendLog("recover", rendered.split("\n")[0] || "恢复");
      const msg = document.createElement("div");
      msg.className = "recovery-event";
      const pre = document.createElement("pre");
      pre.textContent = rendered;
      msg.appendChild(pre);
      $("log").appendChild(msg);
      $("log").scrollTop = $("log").scrollHeight;
    },
    onState: (state) => setStatus(state),
    deps: { maxSteps: settings.maxSteps || 30 },
  });

  try {
    await runtime.run(goal);
    const m = (globalThis.MetricsModule && globalThis.MetricsModule.getMetrics) ? globalThis.MetricsModule.getMetrics() : {};
    currentTask.status = "done";
    currentTask.recoveries = m.recoveryCount || 0;
    currentTask.replans = m.replanCount || 0;
    currentTask.finishedAt = Date.now();
    await historyLog(goal);
    setStatus("done", "done");
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
