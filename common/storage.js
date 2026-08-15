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

// 常用 LLM 预设（小白免配置）：下拉选中即自动填充 Model + Base URL。
// custom 为「自定义」占位，允许高级用户手填任意值。
const PROVIDER_PRESETS = [
  { id: "openai", label: "OpenAI", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", local: false },
  { id: "deepseek", label: "DeepSeek", model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1", local: false },
  { id: "zhipu", label: "智谱 GLM", model: "glm-4-flash", baseURL: "https://open.bigmodel.cn/api/paas/v4", local: false },
  { id: "moonshot", label: "月之暗面 Kimi", model: "moonshot-v1-8k", baseURL: "https://api.moonshot.cn/v1", local: false },
  { id: "ollama", label: "Ollama（本地）", model: "llama3.1", baseURL: "http://localhost:11434/v1", local: true },
  { id: "lmstudio", label: "LM Studio（本地）", model: "local-model", baseURL: "http://localhost:1234/v1", local: true },
  { id: "custom", label: "自定义", model: "", baseURL: "", local: false },
];

// Does this provider require an API key to work? Local inference (Ollama/LM
// Studio) usually runs key-less.
function isLocalProvider(providerId) {
  const p = PROVIDER_PRESETS.find((x) => x.id === providerId);
  return !!(p && p.local);
}

// Find the preset by id (defaults to openai). Returns null for unknown ids.
function findProviderPreset(id) {
  return PROVIDER_PRESETS.find((x) => x.id === id) || null;
}

// Resolve a provider id + optional overrides into concrete settings fields.
// Falls back to the preset's model/baseURL when the given values are blank.
function resolveProviderSettings(id, overrides) {
  const preset = findProviderPreset(id) || PROVIDER_PRESETS[0];
  const o = overrides || {};
  return {
    provider: preset.id,
    model: String(o.model || "").trim() || preset.model,
    baseURL: String(o.baseURL || "").trim() || preset.baseURL,
  };
}

// Onboarding completion flag (stored in chrome.storage.local by the sidepanel).
// Pure helper so it stays unit-testable: true/1/"1" mean done.
function normalizeOnboarding(raw) {
  return raw === true || raw === 1 || raw === "1";
}

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
  module.exports = { DEFAULT_SETTINGS, PROVIDER_PRESETS, normalizeSettings, getSettings, setSettings, isLocalProvider, findProviderPreset, resolveProviderSettings, normalizeOnboarding };
}
