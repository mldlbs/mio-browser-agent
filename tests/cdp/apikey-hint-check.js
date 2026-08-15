"use strict";
// Verify the API-key onboarding hint: when the user starts a task without a
// key (non-local provider), settings auto-open and the key input gets the
// highlight class.
const path = require("path");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./launch");
const ROOT = path.resolve(__dirname, "..", "..");
const SIDEPANEL = pathToFileURL(path.join(ROOT, "sidepanel", "sidepanel.html")).href;

const MOCK = `
(() => {
  const store = {
    agentSettings: { provider: "openai", model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKey: "", maxSteps: 30, enableVision: false,
      vision: { provider: "openai", model: "", baseURL: "", apiKey: "" }, sync: { enabled: false, serverUrl: "", lastSyncAt: 0 } },
    mioCustomTemplates: [], mioTaskHistory: [], mioSession: undefined, mioOnboardingDone: true,
  };
  globalThis.__mioStore = store;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    const isPlan = JSON.stringify(body).includes("submit_plan");
    const msg = isPlan
      ? { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "submit_plan", arguments: JSON.stringify({ steps: [{ description: "完成任务" }] }) } }] }
      : { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "完成" }) } }] };
    return { ok: true, json: async () => ({ choices: [{ message: msg }] }) };
  };
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
  if (result && result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails.exception || {}));
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

    // settings should be collapsed by default
    const closedBefore = await evalJs(b, sessionId, "!document.querySelector('details.settings').open");
    check(closedBefore === true, "settings collapsed before start");

    // start a task without api key -> settings open + key highlighted
    await evalJs(b, sessionId, "document.getElementById('goal').value = '测试任务'; document.getElementById('start').click(); true");
    await new Promise((r) => setTimeout(r, 400));
    const settingsOpen = await evalJs(b, sessionId, "document.querySelector('details.settings').open");
    check(settingsOpen === true, "settings auto-opens when key missing");
    const keyHighlighted = await evalJs(b, sessionId, "document.getElementById('apiKey').classList.contains('key-hint')");
    check(keyHighlighted === true, "apiKey input gets highlight class");
    const startStillEnabled = await evalJs(b, sessionId, "!document.getElementById('start').disabled");
    check(startStillEnabled === true, "start button not disabled (task did not run)");

    // local provider (ollama) allows empty key -> no highlight, task runs
    await evalJs(b, sessionId, "document.getElementById('provider').value = 'ollama'; document.getElementById('start').click(); true");
    await new Promise((r) => setTimeout(r, 300));
    // key-hint class may still be present from the previous 2.5s pulse; the
    // real signal is that the task actually started (start disabled).
    const taskStarted = await evalJs(b, sessionId, "document.getElementById('start').disabled || document.getElementById('status').textContent !== 'idle'");
    check(taskStarted === true, "local provider starts task without key");
    const statusNow = await evalJs(b, sessionId, "document.getElementById('status').textContent");
    console.log("local provider status:", statusNow);
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== API KEY HINT ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
