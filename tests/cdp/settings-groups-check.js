"use strict";
// Verify settings grouping: base config visible, advanced (vision/sync) collapsed
// by default, advanced expands on click.
const path = require("path");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./launch");
const ROOT = path.resolve(__dirname, "..", "..");
const SIDEPANEL = pathToFileURL(path.join(ROOT, "sidepanel", "sidepanel.html")).href;

const MOCK = `
(() => {
  const store = {
    agentSettings: { provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "k", maxSteps: 30, enableVision: false,
      vision: { provider: "openai", model: "", baseURL: "", apiKey: "" }, sync: { enabled: false, serverUrl: "", lastSyncAt: 0 } },
    mioCustomTemplates: [], mioTaskHistory: [], mioSession: undefined, mioOnboardingDone: true,
  };
  globalThis.fetch = async (url, opts) => ({ ok: true, json: async () => ({ token: "tk", email: "a@b.com", lastSyncAt: 0 }) });
  const FAKE = { type: "SNAPSHOT_RESPONSE", payload: { snapshot: { title: "T", url: "https://e.com", elements: [
    { role: "textbox", name: "搜索", inputType: "text", placeholder: "", value: "", tag: "input", href: "", text: "" },
    { role: "button", name: "搜索", inputType: "", placeholder: "", value: "", tag: "button", href: "", text: "搜索" } ] } } };
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "0.1.51" }), onMessage: { addListener() {} }, sendMessage: async () => {} },
    storage: { local: { async get(k){return {[k]:store[k]};}, async set(o){Object.assign(store,o);}, async remove(k){delete store[k];} } },
    tabs: { query: async () => [{ id:1, url:"https://e.com", title:"T", index:0, windowId:1, active:true }],
      get: async (id) => ({ id, url:"https://e.com", title:"T", index:0, windowId:1, active:true }),
      sendMessage: async () => FAKE, onActivated: { addListener(){} }, onUpdated: { addListener(){} } },
    webNavigation: { getAllFrames: async () => [{ frameId:0 }] },
    sidePanel: { close(){} }, windows: { WINDOW_ID_CURRENT:-1, update(){} }, scripting:{}, action:{},
  };
})();`;

let failures = 0;
function check(cond, name) {
  console.log((cond ? "PASS: " : "FAIL: ") + name);
  if (!cond) failures++;
}
async function evalJs(browser, sessionId, expr) {
  const { result } = await browser.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (result && result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result && result.value;
}

async function main() {
  const launched = await launchChrome({ loadExtension: false });
  try {
    const b = launched.browser;
    const { targetId } = await b.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await b.send("Target.attachToTarget", { targetId, flatten: true });
    await b.send("Page.enable", {}, sessionId);
    await b.send("Runtime.enable", {}, sessionId);
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK }, sessionId);
    await b.send("Page.navigate", { url: SIDEPANEL }, sessionId);
    await new Promise((r) => setTimeout(r, 1200));
    await evalJs(b, sessionId, "document.querySelector('details.settings').open = true; true");

    // base config visible
    const baseVisible = await evalJs(b, sessionId, "document.getElementById('provider').offsetParent !== null && document.getElementById('apiKey').offsetParent !== null");
    check(baseVisible === true, "base config (provider/apiKey) visible in settings");
    // advanced collapsed by default
    const advOpen = await evalJs(b, sessionId, "document.querySelector('details.advanced').open");
    check(advOpen === false, "advanced settings collapsed by default");
    const visionHidden = await evalJs(b, sessionId, "document.getElementById('visionModel').offsetParent === null");
    check(visionHidden === true, "vision fields hidden while advanced collapsed");
    // expand advanced
    await evalJs(b, sessionId, "document.querySelector('details.advanced > summary').click(); true");
    await new Promise((r) => setTimeout(r, 200));
    const advOpen2 = await evalJs(b, sessionId, "document.querySelector('details.advanced').open");
    check(advOpen2 === true, "advanced expands on click");
    const visionVisible = await evalJs(b, sessionId, "document.getElementById('visionModel').offsetParent !== null");
    check(visionVisible === true, "vision fields visible after expand");
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== SETTINGS GROUPS ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
