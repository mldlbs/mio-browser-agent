"use strict";
// Verify the result card appears after a completed task (mock LLM), with
// success styling, and rerun/copy/template buttons are wired.
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
      msg = { role: "assistant", content: null, tool_calls: [
        { id: "c" + Date.now(), type: "function", function: { name: "submit_plan", arguments: JSON.stringify({ steps: [{ description: "完成任务" }] }) } },
      ] };
    } else if (globalThis.__failMode) {
      // failing click in exec phase (never succeeds -> recovery exhausts -> task error)
      msg = { role: "assistant", content: null, tool_calls: [
        { id: "c" + Date.now(), type: "function", function: { name: "click", arguments: JSON.stringify({ index: 999 }) } },
      ] };
    } else {
      msg = { role: "assistant", content: null, tool_calls: [
        { id: "c" + Date.now(), type: "function", function: { name: "finish", arguments: JSON.stringify({ summary: "全部完成" }) } },
      ] };
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
  while (Date.now() - start < (ms || 8000)) {
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

    // start a task
    await evalJs(b, sessionId, "document.getElementById('goal').value = '测试任务'; document.getElementById('start').click(); true");
    const cardShown = await waitFor(b, sessionId, "!document.getElementById('resultCard').hidden", 12000);
    check(cardShown === true, "result card appears after task completes");

    const title = await evalJs(b, sessionId, "document.getElementById('resultTitle').textContent");
    check(title === "任务完成", "result card title 任务完成 (got " + JSON.stringify(title) + ")");
    const sum = await evalJs(b, sessionId, "document.getElementById('resultSummary').textContent");
    check(sum.includes("全部完成"), "result card shows summary (got " + JSON.stringify(sum) + ")");
    const isErr = await evalJs(b, sessionId, "document.getElementById('resultCard').classList.contains('error')");
    check(isErr === false, "result card is success-styled");
    const handlers = await evalJs(b, sessionId, "['resultCopy','resultTemplate','resultRerun'].every(id => typeof document.getElementById(id).onclick === 'function')");
    check(handlers === true, "all result action buttons have handlers");

    // rerun: hide card + start again; the second run re-completes and shows the card again
    await evalJs(b, sessionId, "document.getElementById('resultRerun').click(); true");
    const cardShownAgain = await waitFor(b, sessionId, "!document.getElementById('resultCard').hidden", 10000);
    check(cardShownAgain === true, "rerun restarts task and re-shows result card");

    // ── failure scenario: agent tool fails, card shows error + advice + details ──
    // Clear the fetch counter and make the next task fail with ELEMENT_NOT_FOUND.
    await evalJs(b, sessionId, `(() => {
      // reset the mock: plan succeeds, but the exec click always fails
      globalThis.__failMode = true;
      return true;
    })()`);
    // Override fetch to return a failing click in exec phase.
    await evalJs(b, sessionId, `(async () => {
      document.getElementById('goal').value = '失败任务';
      document.getElementById('start').click();
      return true;
    })()`);
    const failCardShown = await waitFor(b, sessionId, "!document.getElementById('resultCard').hidden && document.getElementById('resultCard').classList.contains('error')", 15000);
    check(failCardShown === true, "failure task shows error result card");
    const failTitle = await evalJs(b, sessionId, "document.getElementById('resultTitle').textContent");
    check(failTitle === "任务未完成", "failure card title 任务未完成 (got " + JSON.stringify(failTitle) + ")");
    const adviceVisible = await evalJs(b, sessionId, "!document.getElementById('resultAdvice').hidden && document.getElementById('resultAdvice').textContent.length > 0");
    check(adviceVisible === true, "failure card shows advice");
    const detailsVisible = await evalJs(b, sessionId, "!document.getElementById('resultDetails').hidden");
    check(detailsVisible === true, "failure card shows 查看失败详情 button");
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== RESULT CARD ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
