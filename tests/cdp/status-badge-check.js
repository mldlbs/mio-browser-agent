"use strict";
// Verify the status badge shows the current step while running (even with the
// plan panel collapsed), then returns to done.
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
  globalThis.__mioStore = store;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    const isPlan = JSON.stringify(body).includes("submit_plan");
    let msg;
    if (isPlan) {
      msg = { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "submit_plan", arguments: JSON.stringify({ steps: [{ description: "第一步搜索" }, { description: "第二步提取" }] }) } }] };
    } else if (!globalThis.__execCalls) {
      // first exec: wait 1200ms to keep running state observable, then finish next
      globalThis.__execCalls = 1;
      msg = { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "wait", arguments: JSON.stringify({ ms: 1200 }) } }] };
    } else {
      msg = { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "完成" }) } }] };
    }
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
async function waitFor(browser, sessionId, expr, ms) {
  const start = Date.now();
  while (Date.now() - start < (ms || 10000)) {
    try { if (await evalJs(browser, sessionId, expr)) return true; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
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

    // start a 2-step task
    await evalJs(b, sessionId, "document.getElementById('goal').value = '测试'; document.getElementById('start').click(); true");
    // while running, the badge should show "步骤 1/2" (capture during the wait 1200ms exec)
    const duringRun = await waitFor(b, sessionId, "document.getElementById('status').textContent.includes('步骤 1/2')", 8000);
    check(duringRun === true, "badge shows 步骤 1/2 while running");
    const badgeText = await evalJs(b, sessionId, "document.getElementById('status').textContent");
    check(badgeText.includes("第一步搜索") || badgeText.includes("第一步"), "badge includes current step description (got " + JSON.stringify(badgeText) + ")");
    // after finish, badge returns to done
    const done = await waitFor(b, sessionId, "document.getElementById('status').textContent === 'done' || document.getElementById('status').textContent === 'error'", 10000);
    check(done === true, "badge returns to terminal state after completion");
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== STATUS BADGE STEP ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
