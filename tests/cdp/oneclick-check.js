"use strict";
// Verify one-click flow: clicking a template with placeholders fills the goal,
// auto-starts the task (no extra 开始 click needed), and a successful run shows
// the result card. Mock window.prompt so the placeholder dialog auto-fills.
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
  // placeholder dialog auto-fills "测试值"
  globalThis.prompt = () => "测试值";
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    const isPlan = JSON.stringify(body).includes("submit_plan");
    const msg = isPlan
      ? { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "submit_plan", arguments: JSON.stringify({ steps: [{ description: "完成任务" }] }) } }] }
      : { role: "assistant", content: null, tool_calls: [{ id: "c" + Date.now(), type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "一键完成" }) } }] };
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
    await new Promise((r) => setTimeout(r, 200));
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

    // expand templates, click the first placeholder template (search-extract has {site}/{keyword})
    await evalJs(b, sessionId, "document.getElementById('templatesToggle').click(); true");
    await evalJs(b, sessionId, "Array.from(document.querySelectorAll('#composeTemplates .template-chip'))[0].click(); true");
    // auto-started -> should reach running then done + result card
    const cardShown = await waitFor(b, sessionId, "!document.getElementById('resultCard').hidden", 15000);
    check(cardShown === true, "template click auto-starts and completes");
    const goal = await evalJs(b, sessionId, "document.getElementById('goal').value");
    check(goal.includes("测试值"), "goal filled from placeholder dialog (got " + JSON.stringify(goal) + ")");
    const sum = await evalJs(b, sessionId, "document.getElementById('resultSummary').textContent");
    check(sum.includes("一键完成"), "result card shows completed summary (got " + JSON.stringify(sum) + ")");
    // start button should be re-enabled (not disabled after auto flow)
    const startDisabled = await evalJs(b, sessionId, "document.getElementById('start').disabled");
    check(startDisabled === false, "start button re-enabled after auto flow");
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== ONE-CLICK TEMPLATE ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
