const $ = (id) => document.getElementById(id);

let runtime = null;

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

  runtime = createAgentRuntime({
    settings,
    bridge: createPageBridge(),
    onLog: (tag, text) => appendLog(tag, text),
    onState: (state) => setStatus(state),
    deps: { maxSteps: settings.maxSteps || 30 },
  });

  try {
    await runtime.run(goal);
    setStatus("done", "done");
  } catch (e) {
    appendLog("error", e.message || String(e));
    setStatus("error", "error");
  } finally {
    $("start").disabled = false;
  }
}

init().catch((e) => appendLog("error", "初始化失败: " + (e && e.message || e)));
