"use strict";
// Verify the "更多菜单" + 模板折叠 interactions: more menu toggles,
// history/sched open from menu, templates collapse/expand, all ids intact.
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
    mioCustomTemplates: [], mioTaskHistory: [], mioSession: null, mioOnboardingDone: true,
  };
  globalThis.__mioStore = store;
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

    // more menu hidden by default, toggles open
    let m = await evalJs(b, sessionId, "document.getElementById('morePopup').hidden");
    check(m === true, "more menu hidden by default");
    await evalJs(b, sessionId, "document.getElementById('moreToggle').click(); true");
    m = await evalJs(b, sessionId, "document.getElementById('morePopup').hidden");
    check(m === false, "more menu opens on ⋯ click");
    await evalJs(b, sessionId, "document.getElementById('moreToggle').click(); true");
    m = await evalJs(b, sessionId, "document.getElementById('morePopup').hidden");
    check(m === true, "more menu closes on second ⋯ click");

    // history opens from more menu
    await evalJs(b, sessionId, "document.getElementById('moreToggle').click(); document.getElementById('historyToggle').click(); true");
    m = await evalJs(b, sessionId, "document.getElementById('morePopup').hidden === true && document.getElementById('historyView').classList.contains('open')");
    check(m === true, "history opens from more menu and menu closes");
    await evalJs(b, sessionId, "document.getElementById('historyToggle').click(); true");

    // sched opens from more menu
    await evalJs(b, sessionId, "document.getElementById('moreToggle').click(); document.getElementById('schedToggle').click(); true");
    m = await evalJs(b, sessionId, "document.getElementById('morePopup').hidden === true && document.getElementById('schedView').classList.contains('open')");
    check(m === true, "sched opens from more menu and menu closes");
    await evalJs(b, sessionId, "document.getElementById('schedToggle').click(); true");

    // templates collapsed by default, toggle expands
    m = await evalJs(b, sessionId, "document.getElementById('composeTemplates').classList.contains('collapsed') && document.getElementById('templatesToggle') !== null");
    check(m === true, "templates collapsed by default with toggle present");
    const collapsedChips = await evalJs(b, sessionId, "document.querySelectorAll('#composeTemplates .template-wrap').length");
    const visibleChips = await evalJs(b, sessionId, "Array.from(document.querySelectorAll('#composeTemplates .template-wrap')).filter(e => getComputedStyle(e).display !== 'none').length");
    check(visibleChips === 0, "no template chips visible while collapsed (count " + collapsedChips + " total)");
    await evalJs(b, sessionId, "document.getElementById('templatesToggle').click(); true");
    const visibleChips2 = await evalJs(b, sessionId, "Array.from(document.querySelectorAll('#composeTemplates .template-wrap')).filter(e => getComputedStyle(e).display !== 'none').length");
    check(visibleChips2 > 0, "template chips visible after expand");
    const toggleText = await evalJs(b, sessionId, "document.getElementById('templatesToggle').textContent");
    check(toggleText.includes("▾"), "template toggle shows ▾ when expanded");
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== MORE MENU + TEMPLATES ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
