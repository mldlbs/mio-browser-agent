const DEFAULT_SETTINGS = {
  provider: "openai",
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  maxSteps: 30,
  enableVision: false,
  // 视觉兜底使用独立模型配置，与主对话模型完全分离。
  // 留空则回退用主对话模型（行为同历史版本）。
  vision: {
    provider: "openai",
    model: "",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
  },
  sync: {
    enabled: false,
    serverUrl: "",
    lastSyncAt: 0,
  },
};

function normalizeVision(v) {
  return Object.assign({}, DEFAULT_SETTINGS.vision, v || {});
}

function normalizeSync(v) {
  return Object.assign({}, DEFAULT_SETTINGS.sync, v || {});
}

function normalizeSettings(s) {
  const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
  out.vision = normalizeVision(out.vision);
  out.sync = normalizeSync(out.sync);
  return out;
}

async function getSettings() {
  const raw = await chrome.storage.local.get("agentSettings");
  return normalizeSettings(raw.agentSettings);
}

async function setSettings(settings) {
  await chrome.storage.local.set({ agentSettings: normalizeSettings(settings) });
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULT_SETTINGS, normalizeSettings, getSettings, setSettings };
}
