const DEFAULT_SETTINGS = {
  provider: "openai",
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  maxSteps: 30,
  enableVision: false,
};

function normalizeSettings(s) {
  return Object.assign({}, DEFAULT_SETTINGS, s || {});
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
