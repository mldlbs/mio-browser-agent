const $ = (id) => document.getElementById(id);

let runtime = null;
let currentTask = null;
let planCollapsed = false;
let planProgress = { steps: [], done: [], failed: [], replanned: false };
let _historyPage = 0;
let expandedFailureStep = null;
let _lastSuggestUrl = "";
const SYNC_SERVER = "https://sync.crlkcloud.cyou";

// Refresh the "本页可做" suggestions from the current page's snapshot. Pure
// heuristic (no LLM): maps page element patterns to one-click task cards.
async function renderSuggestions() {
  const panel = $("suggestPanel");
  const list = $("suggestList");
  if (!panel || !list) return;
  let peek;
  try {
    const bridge = createPageBridge();
    peek = await bridge.snapshotPeek();
  } catch (e) {
    panel.hidden = true;
    return;
  }
  if (!peek || !peek.elements || !peek.elements.length) {
    panel.hidden = true;
    return;
  }
  // Skip refresh if the page hasn't changed (e.g. user clicked 刷新 repeatedly).
  const key = peek.url + "|" + peek.title;
  if (key === _lastSuggestUrl) {
    if (panel.hidden) panel.hidden = false;
    return;
  }
  _lastSuggestUrl = key;
  let tasks = SuggestModule.suggestTasks(peek);
  // 叠加任务记忆：同域名高频任务置顶（标注"常用"），启发式推荐补充。
  const domain = TaskMemoryModule.extractDomain(peek.url);
  if (domain) {
    const memory = await TaskMemoryModule.getMemory();
    tasks = TaskMemoryModule.mergeSuggestions(TaskMemoryModule.getDomainGoals(memory, domain), tasks);
  }
  if (!tasks.length) { panel.hidden = true; return; }
  panel.hidden = false;
  list.innerHTML = "";
  const icons = { memory: "⭐", search: "🔍", login: "🔑", "extract-table": "📊", "form-fill": "📝", "extract-links": "🔗", "crawl-pages": "📄", "extract-text": "📃" };
  tasks.forEach((t) => {
    const item = document.createElement("div");
    item.className = "suggest-task" + (t.frequent ? " frequent" : "");
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.textContent = icons[t.id] || "✨";
    const body = document.createElement("div");
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = t.label;
    if (t.frequent) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "常用";
      label.appendChild(badge);
    }
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = t.hint || "";
    body.appendChild(label);
    body.appendChild(hint);
    item.appendChild(icon);
    item.appendChild(body);
    item.title = t.goal;
    item.addEventListener("click", () => applyTemplateWithPrompt(t));
    list.appendChild(item);
  });
}

function wireSuggestListeners() {
  const refresh = $("suggestRefresh");
  if (refresh) refresh.addEventListener("click", () => { _lastSuggestUrl = ""; renderSuggestions(); });
  // Re-suggest when the active tab changes or finishes loading.
  chrome.tabs.onActivated.addListener(() => renderSuggestions());
  chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
    if (changeInfo.status === "complete") renderSuggestions();
  });
}

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

// Fill a template's {placeholders} interactively, then put the completed goal
// into the compose box. Falls back to raw goal text when there are no
// placeholders or the user cancels.
function applyTemplateWithPrompt(t) {
  const box = $("goal");
  const placeholders = TemplatesModule.extractPlaceholders(t.goal);
  if (!placeholders.length) {
    box.value = t.goal;
    box.focus();
    box.setSelectionRange(0, 0);
    return;
  }
  const values = {};
  let ok = true;
  for (const key of placeholders) {
    const val = prompt(`填写「${t.label}」的 ${key}:`, "");
    if (val === null) { ok = false; break; }
    values[key] = val;
  }
  if (!ok) return;
  box.value = TemplatesModule.applyTemplate(t, values);
  box.focus();
  box.setSelectionRange(0, 0);
  toast("模板已填充，可继续修改");
}

// Fill the Model / Base URL fields from the selected provider preset.
function applyProviderPreset(providerId) {
  const preset = findProviderPreset(providerId);
  if (!preset) return;
  if (preset.model) $("model").value = preset.model;
  if (preset.baseURL) $("baseUrl").value = preset.baseURL;
}

// Quick connectivity probe: POST a minimal chat to the configured provider.
// Local inference (Ollama/LM Studio) and remote providers both answer a tiny
// request, so a 200/valid JSON reply means the config works.
async function testConnection() {
  const btn = $("testConnection");
  const status = $("testConnectionStatus");
  btn.disabled = true;
  status.textContent = "测试中…";
  status.style.color = "var(--overlay)";
  try {
    const provider = $("provider").value;
    const model = $("model").value.trim();
    const baseURL = ($("baseUrl").value.trim() || "").replace(/\/+$/, "");
    const apiKey = $("apiKey").value.trim();
    if (!baseURL) throw new Error("请填写 Base URL");
    if (!model) throw new Error("请填写 Model");
    const res = await fetch(baseURL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "Authorization": "Bearer " + apiKey } : {}) },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 120));
    status.textContent = "连接正常 ✓";
    status.style.color = "var(--green)";
    toast("连接成功");
  } catch (e) {
    status.textContent = "连接失败: " + ((e && e.message) || String(e)).slice(0, 60);
    status.style.color = "var(--red)";
  } finally {
    btn.disabled = false;
  }
}

// Render the one-click task templates above the goal box. Clicking a template
// prompts for its {placeholders} and fills the completed goal.
async function renderTemplates() {
  const host = $("composeTemplates");
  if (!host) return;
  const tmpls = (globalThis.TemplatesModule && await TemplatesModule.getTemplates()) || [];
  host.innerHTML = "";
  // 折叠开关：默认只露「模板 ▸」，展开显示全部模板 chips + 导入
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.id = "templatesToggle";
  toggleBtn.className = "template-import";
  toggleBtn.textContent = "模板 ▸";
  toggleBtn.addEventListener("click", () => {
    const collapsed = host.classList.toggle("collapsed");
    toggleBtn.textContent = collapsed ? "模板 ▸" : "模板 ▾";
  });
  host.appendChild(toggleBtn);
  host.classList.add("collapsed");
  for (const t of tmpls) {
    const wrap = document.createElement("div");
    wrap.className = "template-wrap";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "template-chip" + (t.custom ? " custom" : "");
    chip.textContent = t.label;
    chip.title = t.hint || "";
    chip.addEventListener("click", () => applyTemplateWithPrompt(t));
    wrap.appendChild(chip);
    const share = document.createElement("button");
    share.type = "button";
    share.className = "template-share";
    share.textContent = "↗";
    share.title = "复制该模板的分享 JSON";
    share.addEventListener("click", (e) => {
      e.stopPropagation();
      copyShareTemplate(t);
    });
    wrap.appendChild(share);
    host.appendChild(wrap);
  }
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "template-import";
  importBtn.textContent = "＋ 导入模板";
  importBtn.title = "粘贴别人分享的模板 JSON 直接导入使用";
  importBtn.addEventListener("click", importTemplate);
  host.appendChild(importBtn);
}

// ── 云同步登录（设置区内嵌，不在 header 露脸）──
async function renderSettingsAuthState() {
  const loggedIn = await AuthClient.isLoggedIn();
  const out = $("syncLoggedOut");
  const inn = $("syncLoggedIn");
  if (!out || !inn) return;
  if (loggedIn) {
    const session = await AuthClient.getSession();
    out.style.display = "none";
    inn.style.display = "";
    $("syncEmailDisplay").textContent = session ? session.email : "—";
    $("syncStatus").textContent = session && session.lastSyncAt
      ? "上次同步: " + new Date(session.lastSyncAt).toLocaleString()
      : "";
  } else {
    inn.style.display = "none";
    out.style.display = "";
    $("syncFormStatus").textContent = "";
  }
}

async function wireSyncAuth() {
  const registerBtn = $("syncRegister");
  const loginBtn = $("syncLogin");
  const logoutBtn = $("syncLogout");
  const syncNowBtn = $("syncNow");
  const setFormStatus = (text, ok) => {
    const el = $("syncFormStatus");
    if (el) { el.textContent = text; el.style.color = ok ? "var(--green)" : "var(--red)"; }
  };
  if (registerBtn) registerBtn.addEventListener("click", async () => {
    const email = $("syncEmail").value.trim();
    const password = $("syncPassword").value;
    if (!email || !password) return setFormStatus("请填写邮箱和密码", false);
    try {
      await AuthClient.register(email, password, SYNC_SERVER);
      setFormStatus("注册成功", true);
      await renderSettingsAuthState();
    } catch (e) {
      setFormStatus("注册失败: " + (e && e.status === 409 ? "邮箱已注册" : "无法连接服务器"), false);
    }
  });
  if (loginBtn) loginBtn.addEventListener("click", async () => {
    const email = $("syncEmail").value.trim();
    const password = $("syncPassword").value;
    if (!email || !password) return setFormStatus("请填写邮箱和密码", false);
    try {
      await AuthClient.login(email, password, SYNC_SERVER);
      setFormStatus("登录成功", true);
      await renderSettingsAuthState();
    } catch (e) {
      setFormStatus("登录失败: " + (e && e.status === 401 ? "邮箱或密码错误" : "无法连接服务器"), false);
    }
  });
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    const s = await AuthClient.getSession();
    await AuthClient.logout(s && s.serverUrl);
    await renderSettingsAuthState();
    toast("已登出");
  });
  if (syncNowBtn) syncNowBtn.addEventListener("click", async () => {
    const session = await AuthClient.getSession();
    if (!session) return toast("请先登录");
    try {
      const hist = await HistoryModule.getHistory();
      const res = await SyncClient.syncHistory(session.serverUrl, session.token, hist);
      if (res.merged && HistoryModule._setRawHistory) await HistoryModule._setRawHistory(res.merged);
      $("syncStatus").textContent = "已同步 · 拉取 " + res.pulled + " · 上传 " + res.pushed;
      toast("同步完成");
    } catch (e) {
      $("syncStatus").textContent = "同步失败";
    }
  });
}

async function init() {
  const verEl = $("version");
  if (verEl && globalThis.chrome && chrome.runtime && chrome.runtime.getManifest) {
    verEl.textContent = "v" + (chrome.runtime.getManifest().version || "");
  }
  await renderTemplates();
  wireSuggestListeners();
  renderSuggestions();
  wireSchedListeners();
  updateSchedGoalPreview();
  const s = await getSettings();
  $("provider").value = s.provider;
  applyProviderPreset(s.provider);
  // 已保存过自定义值（非空且不是预设默认值）时保留用户手填内容
  if (s.model) $("model").value = s.model;
  if (s.baseURL) $("baseUrl").value = s.baseURL;
  $("apiKey").value = s.apiKey;
  $("maxSteps").value = s.maxSteps;
  $("enableVision").checked = !!s.enableVision;
  const v = s.vision || {};
  $("visionModel").value = v.model || "";
  $("visionBaseUrl").value = v.baseURL || "https://open.bigmodel.cn/api/paas/v4";
  $("visionApiKey").value = v.apiKey || "";
  const sync = s.sync || {};
  if (sync.lastSyncAt) $("syncStatus").textContent = "上次同步: " + new Date(sync.lastSyncAt).toLocaleString();

  $("provider").addEventListener("change", () => {
    if ($("provider").value === "custom") return; // 自定义保留用户已填内容
    applyProviderPreset($("provider").value);
  });

  $("testConnection").addEventListener("click", testConnection);

  await renderSettingsAuthState();
  await wireSyncAuth();

  $("saveSettings").addEventListener("click", async () => {
    const provider = $("provider").value;
    const resolved = resolveProviderSettings(provider, {
      model: $("model").value.trim(),
      baseURL: $("baseUrl").value.trim(),
    });
    await setSettings({
      provider: resolved.provider,
      model: resolved.model,
      baseURL: resolved.baseURL,
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
        serverUrl: (await getSettings()).sync && (await getSettings()).sync.serverUrl || "",
        lastSyncAt: (await getSettings()).sync && (await getSettings()).sync.lastSyncAt || 0,
      },
    });
    toast("设置已保存");
  });

  $("start").addEventListener("click", startTask);
  $("stop").addEventListener("click", () => { if (runtime) runtime.stop(); });
  // 更多菜单（渐进式披露：历史/定时收进下拉）
  const moreToggle = $("moreToggle");
  const morePopup = $("morePopup");
  if (moreToggle && morePopup) {
    moreToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      morePopup.hidden = !morePopup.hidden;
    });
    document.addEventListener("click", (e) => {
      const menu = morePopup;
      const btn = moreToggle;
      if (menu && !menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.hidden = true;
      }
    });
    const closeMore = () => { morePopup.hidden = true; };
    $("historyToggle").addEventListener("click", closeMore);
    $("schedToggle").addEventListener("click", closeMore);
  }
  $("historyToggle").addEventListener("click", toggleHistory);
  $("historyClose").addEventListener("click", toggleHistory);
  $("historyClear").addEventListener("click", clearHistory);                                                
  $("historyStats").addEventListener("click", toggleFailureStats);
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

  maybeShowOnboarding();
}

// ── 定时任务 ──
function toggleSched() {
  const view = $("schedView");
  const showing = view.classList.toggle("open");
  const log = $("log");
  if (showing) {
    if ($("historyView").classList.contains("open")) {
      $("historyView").classList.remove("open");
      $("planPanel").style.display = $("planPanel").dataset.prevDisplay || "none";
      delete $("planPanel").dataset.prevDisplay;
    }
    log.style.display = "none";
    renderSchedules();
  } else {
    log.style.display = "";
  }
}

function updateSchedGoalPreview() {
  const g = $("goal").value.trim();
  $("schedGoalFromCompose").value = g;
  $("schedGoalFromCompose").title = g || "";
}

async function renderSchedules() {
  const list = $("schedList");
  list.innerHTML = "";
  const schedules = await SchedulerModule.getSchedules();
  if (!schedules.length) {
    const empty = document.createElement("div");
    empty.className = "sched-empty";
    empty.textContent = "还没有定时任务。填好目标 → 添加，mio 就会到点自动跑。";
    list.appendChild(empty);
    return;
  }
  for (const s of schedules) {
    const item = document.createElement("div");
    item.className = "sched-item" + (s.enabled ? "" : " disabled");
    const goal = document.createElement("div");
    goal.className = "sched-item-goal";
    goal.textContent = s.goal;
    const meta = document.createElement("div");
    let metaText = SchedulerModule.describeSchedule(s);
    if (s.lastRunAt) {
      metaText += " · 上次: " + (s.lastStatus === "done" ? "✓" : s.lastStatus === "error" ? "✗" : s.lastStatus || "—");
      if (s.lastSummary) metaText += " " + s.lastSummary.slice(0, 60);
    }
    meta.textContent = metaText;
    meta.className = "sched-item-meta" + (s.lastStatus === "error" ? " err" : s.lastStatus === "done" ? " ok" : "");
    const actions = document.createElement("div");
    actions.className = "sched-item-actions";
    const runBtn = document.createElement("button");
    runBtn.className = "sched-run-now";
    runBtn.textContent = "立即执行";
    runBtn.addEventListener("click", () => {
      runBtn.disabled = true;
      toast("已触发执行，稍后查看结果");
      chrome.runtime.sendMessage({ type: "SCHEDULE_RUN_NOW", id: s.id }).catch(() => toast("触发失败"));
    });
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "sched-toggle-btn";
    toggleBtn.textContent = s.enabled ? "停用" : "启用";
    toggleBtn.addEventListener("click", async () => {
      await SchedulerModule.toggleSchedule(s.id, !s.enabled);
      chrome.runtime.sendMessage({ type: "SCHEDULE_SYNC" }).catch(() => {});
      renderSchedules();
    });
    const delBtn = document.createElement("button");
    delBtn.className = "sched-del";
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", async () => {
      await SchedulerModule.deleteSchedule(s.id);
      chrome.runtime.sendMessage({ type: "SCHEDULE_SYNC" }).catch(() => {});
      renderSchedules();
    });
    actions.appendChild(runBtn);
    actions.appendChild(toggleBtn);
    actions.appendChild(delBtn);
    item.appendChild(goal);
    item.appendChild(meta);
    item.appendChild(actions);
    list.appendChild(item);
  }
}

async function addSchedule(goal) {
  const g = String(goal || "").trim();
  if (!g) { toast("请填写任务目标"); return; }
  const frequency = $("schedFrequency").value;
  const schedule = SchedulerModule.normalizeSchedule({
    goal: g,
    url: $("schedUrl").value.trim(),
    frequency,
    time: $("schedTime").value || "09:00",
    weekday: parseInt($("schedWeekday").value, 10) || 1,
    intervalMinutes: parseInt($("schedInterval").value, 10) || 60,
    enabled: true,
  });
  await SchedulerModule.saveSchedule(schedule);
  $("schedGoal").value = "";
  chrome.runtime.sendMessage({ type: "SCHEDULE_SYNC" }).catch(() => {});
  renderSchedules();
  toast("定时任务已添加：" + SchedulerModule.describeSchedule(schedule));
}

function wireSchedListeners() {
  const freq = $("schedFrequency");
  const showRows = () => {
    $("schedWeekdayRow").hidden = freq.value !== "weekly";
    $("schedIntervalRow").hidden = freq.value !== "interval";
    $("schedTime").closest(".sched-form-row").hidden = freq.value === "interval";
  };
  freq.addEventListener("change", showRows);
  showRows();
  $("schedToggle").addEventListener("click", toggleSched);
  $("schedClose").addEventListener("click", toggleSched);
  $("schedAdd").addEventListener("click", () => addSchedule($("schedGoal").value));
  $("schedAddFromCompose").addEventListener("click", () => addSchedule($("goal").value));
  $("goal").addEventListener("input", updateSchedGoalPreview);
  $("historyToggle").addEventListener("click", () => {
    if ($("schedView").classList.contains("open")) toggleSched();
  });
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "SCHEDULED_RESULT") {
      toast("定时任务" + (msg.status === "done" ? "完成 ✓" : "失败 ✗"));
      if ($("schedView").classList.contains("open")) renderSchedules();
    }
  });
}

// ── 首次使用引导（onboarding）──
const ONBOARD_KEY = "mioOnboardingDone";

async function shouldShowOnboarding() {
  if (!globalThis.chrome || !chrome.storage || !chrome.storage.local) return false;
  const raw = await chrome.storage.local.get(ONBOARD_KEY);
  return !normalizeOnboarding(raw[ONBOARD_KEY]);
}

async function finishOnboarding(never) {
  try {
    await chrome.storage.local.set({ [ONBOARD_KEY]: true });
  } catch (_) {}
  $("onboardMask").hidden = true;
  if (never) toast("已关闭引导，之后不会打扰你");
}

function wireOnboarding() {
  const mask = $("onboardMask");
  if (!mask) return;
  const steps = mask.querySelectorAll(".onboard-step");
  const dotsHost = $("onboardDots");
  const nextBtn = $("onboardNext");
  const skipBtn = $("onboardSkip");
  const neverCb = $("onboardNever");
  let step = 0;

  const dots = [];
  for (let i = 0; i < steps.length; i++) {
    const dot = document.createElement("span");
    dot.className = "onboard-dot" + (i === 0 ? " active" : "");
    dotsHost.appendChild(dot);
    dots.push(dot);
  }
  const render = () => {
    steps.forEach((el, i) => el.classList.toggle("active", i === step));
    dots.forEach((el, i) => el.classList.toggle("active", i === step));
    nextBtn.textContent = step === steps.length - 1 ? "开始使用" : "下一步";
  };
  nextBtn.addEventListener("click", () => {
    if (step < steps.length - 1) {
      step++;
      render();
    } else {
      finishOnboarding(neverCb.checked);
    }
  });
  skipBtn.addEventListener("click", () => finishOnboarding(neverCb.checked));
  render();
}

async function maybeShowOnboarding() {
  if (!(await shouldShowOnboarding())) return;
  const mask = $("onboardMask");
  if (!mask) return;
  wireOnboarding();
  mask.hidden = false;
}

function toggleHistory() {
  const view = $("historyView");
  const showing = view.classList.toggle("open");
  const log = $("log");
  const plan = $("planPanel");
  if (showing) {
    // History list and log/plan panels are both flex:1 — hide the panels while
    // browsing history so the list gets the full height and its own scrollbar.
    if ($("schedView").classList.contains("open")) $("schedView").classList.remove("open");
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

// Copy the shareable JSON of a single task to the clipboard (MV3 sidepanel is
// a trusted page, so navigator.clipboard works without extra permissions).
async function copyShareHistory(r) {
  try {
    const share = HistoryModule.buildShareRecord(r);
    await navigator.clipboard.writeText(JSON.stringify(share, null, 2));
    toast("分享 JSON 已复制");
  } catch (e) {
    toast("复制失败: " + (e && e.message || e));
  }
}

// Save a finished task's goal as a reusable template (local template
// marketplace closure: "share a task" -> "reuse it as a template").
async function saveTaskAsTemplate(r) {
  const label = prompt("给模板起个名字：", (r.goal || "我的模板").slice(0, 20));
  if (label === null) return;
  try {
    const added = await TemplatesModule.addCustomTemplate({ label: label.trim() || "我的模板", goal: r.goal });
    if (added) {
      await renderTemplates();
      toast("已保存为模板");
      const share = confirm("已保存为模板。现在把分享文本复制到剪贴板？");
      if (share) await copyShareTemplate(added);
    } else {
      toast("该模板已存在");
    }
  } catch (e) {
    toast("保存失败: " + (e && e.message || e));
  }
}

// Copy a template's shareable JSON to the clipboard. Compatible with the task
// share format's privacy rules: goal + placeholders only, no credentials/URLs.
async function copyShareTemplate(tpl) {
  try {
    const share = TemplatesModule.buildShareTemplate(tpl);
    await navigator.clipboard.writeText(JSON.stringify(share, null, 2));
    toast("模板分享 JSON 已复制");
  } catch (e) {
    toast("复制失败: " + (e && e.message || e));
  }
}

// Import a shared template from pasted JSON and add it to custom templates.
async function importTemplate() {
  const raw = prompt("粘贴分享的模板 JSON：");
  if (raw === null) return;
  if (!raw.trim()) return toast("内容为空");
  try {
    const tpl = TemplatesModule.parseShareTemplate(raw);
    const added = await TemplatesModule.addCustomTemplate(tpl);
    if (added) {
      await renderTemplates();
      toast("模板导入成功：「" + added.label + "」，点击即可使用");
    } else {
      toast("该模板已存在");
    }
  } catch (e) {
    toast("导入失败: " + (e && e.message || e));
  }
}

async function historyLog(goal) {
  if (!currentTask) return;
  currentTask.logs.push({ tag: "debug", text: "目标: " + goal, ts: Date.now() });
  await HistoryModule.addHistoryRecord(currentTask);
  // 任务记忆：仅存 goal 文本 + 当前域名（纯本地，绝不同步云端）。
  try {
    const tab = await getActiveTab();
    const domain = TaskMemoryModule.extractDomain(tab && tab.url);
    if (domain) await TaskMemoryModule.recordGoal(domain, goal);
  } catch (_) { /* 静默，不打断任务完成 */ }
  const session = await AuthClient.getSession();
  if (session && session.serverUrl) {
    try {
      const res = await SyncClient.syncHistory(session.serverUrl, session.token, await HistoryModule.getHistory());
      if (res.merged && HistoryModule._setRawHistory) await HistoryModule._setRawHistory(res.merged);
    } catch (_) { /* 静默，不打断任务完成 */ }
  }
  currentTask = null;
}

// ── 失败分析（failure stats）──
function toggleFailureStats() {
  const banner = $("statsBanner");
  if (banner) {
    banner.remove();
    return;
  }
  renderFailureStats();
}

async function renderFailureStats() {
  const list = $("historyList");
  const records = await HistoryModule.getHistory();
  const stats = FailureStatsModule.successRate(records);
  const top = FailureStatsModule.topErrors(records, 3);
  const banner = document.createElement("div");
  banner.id = "statsBanner";
  banner.className = "stats-banner";
  const title = document.createElement("div");
  title.className = "stats-title";
  title.textContent = "失败分析";
  banner.appendChild(title);
  if (!stats.total) {
    banner.appendChild(document.createTextNode("还没有任务记录，跑几次任务后再来看看。"));
  } else {
    const rate = Math.round(stats.successRate * 100);
    const line1 = document.createElement("div");
    line1.innerHTML = "共 <b>" + stats.total + "</b> 次任务，成功 <b>" + (stats.total - stats.failed) + "</b> 次（成功率 " + rate + "%）";
    banner.appendChild(line1);
    if (top.length) {
      const line2 = document.createElement("div");
      line2.innerHTML = "最容易失败的环节：";
      banner.appendChild(line2);
      for (const t of top) {
        const item = document.createElement("div");
        const m = globalThis.ErrorMsgModule ? ErrorMsgModule.errorToHuman(t.code) : { human: t.code };
        item.innerHTML = "· <b>" + t.count + "</b> 次 — " + m.human;
        banner.appendChild(item);
      }
    }
  }
  list.parentNode.insertBefore(banner, list);
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
      const copyBtn = document.createElement("button");
      copyBtn.className = "history-copy";
      copyBtn.textContent = "复制";
      copyBtn.title = "复制分享 JSON 到剪贴板";
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyShareHistory(r);
      });
      actions.appendChild(copyBtn);
      const tplBtn = document.createElement("button");
      tplBtn.className = "history-template";
      tplBtn.textContent = "存模板";
      tplBtn.title = "把该任务目标保存为可复用模板";
      tplBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        saveTaskAsTemplate(r);
      });
      actions.appendChild(tplBtn);
      const shareTplBtn = document.createElement("button");
      shareTplBtn.className = "history-share-template";
      shareTplBtn.textContent = "模板分享";
      shareTplBtn.title = "直接复制该任务作为模板的分享 JSON（不含凭据/URL）";
      shareTplBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copyShareTemplate({ label: (r.goal || "我的模板").slice(0, 20), goal: r.goal, hint: "由历史任务生成的模板" });
      });
      actions.appendChild(shareTplBtn);
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

// 结果卡片：任务结束后给小白一个醒目的完成/失败反馈 + 快捷操作。
function showResultCard(result, goal) {
  const card = $("resultCard");
  if (!card) return;
  const ok = !!result.ok;
  const summary = ok ? (result.summary || "任务完成") : (result.error || "任务失败");
  const cardGoal = goal;
  card.hidden = false;
  card.classList.toggle("error", !ok);
  $("resultIcon").textContent = ok ? "✓" : "✗";
  $("resultTitle").textContent = ok ? "任务完成" : "任务未完成";
  $("resultSummary").textContent = summary;
  // 重新绑定操作（避免重复监听累积）
  const copyBtn = $("resultCopy");
  const tplBtn = $("resultTemplate");
  const rerunBtn = $("resultRerun");
  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      toast("结果已复制");
    } catch (_) { toast("复制失败"); }
  };
  tplBtn.onclick = async () => {
    const label = prompt("给模板起个名字：", (cardGoal || "我的模板").slice(0, 20));
    if (label === null) return;
    const added = await TemplatesModule.addCustomTemplate({ label: label.trim() || "我的模板", goal: cardGoal });
    if (added) { await renderTemplates(); toast("已保存为模板"); }
    else toast("该模板已存在");
  };
  rerunBtn.onclick = () => {
    card.hidden = true;
    startTask({ goal: cardGoal });
  };
}

function hideResultCard() {
  const card = $("resultCard");
  if (card) card.hidden = true;
}

async function startTask(resume) {
  if ($("start").disabled) return;
  const goal = resume && resume.goal ? resume.goal : $("goal").value.trim();
  if (!goal) { toast("请输入任务目标"); return; }
  if (resume) $("goal").value = goal;
  const resolved = resolveProviderSettings($("provider").value, {
    model: $("model").value.trim(),
    baseURL: $("baseUrl").value.trim(),
  });
  const settings = {
    provider: resolved.provider,
    model: resolved.model,
    baseURL: resolved.baseURL,
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
  // 本地推理（Ollama/LM Studio）允许空 Key；远端 provider 必须有 Key。
  if (!settings.apiKey && !isLocalProvider(settings.provider)) {
    toast("请先填写 API Key（本地模型可留空）");
    $("apiKey").focus();
    return;
  }

  $("log").innerHTML = "";
  hideResultCard();
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
        const human = globalThis.ErrorMsgModule ? ErrorMsgModule.humanizeError(ev.code, ev.message) : (ev.code + (ev.message ? ": " + ev.message : ""));
        appendLog("recover", `步骤 ${stepNum} ❌ ${human}`);
      } else if (ev.kind === "outcome" && ev.outcome === "exhausted") {
        appendLog("recover", "✗ 我试了几种办法都没成功（点击计划面板失败步骤查看详情）");
      }
    },
    onStepEvent: (ev) => {
      if (!currentTask) return;
      currentTask.stepEvents = currentTask.stepEvents || [];
      currentTask.stepEvents.push(ev);
      // 实时重绘：失败步骤的恢复记录随事件追加即时刷新
      if (ev.type === "recovery" && ev.stepIndex !== undefined && planProgress.failed.includes(ev.stepIndex)) {
        renderPlanPanel();
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
        expandedFailureStep = null;
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
    showResultCard(result, goal);
    setStatus(currentTask.status, currentTask.status);
  } catch (e) {
    currentTask.status = "error";
    currentTask.summary = e.message || String(e);
    currentTask.finishedAt = Date.now();
    await historyLog(goal);
    appendLog("error", e.message || String(e));
    showResultCard({ ok: false, error: (e && e.message) || String(e) }, goal);
    setStatus("error", "error");
  } finally {
    $("start").disabled = false;
  }
}

init().catch((e) => appendLog("error", "初始化失败: " + (e && e.message || e)));
