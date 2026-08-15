"use strict";
// Verify the history view stays within bounds (no horizontal overflow) across
// the sidepanel's draggable width range. Fails on any overflow.
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
    mioCustomTemplates: [], mioSession: null, mioOnboardingDone: true,
    mioTaskHistory: Array.from({ length: 5 }, (_, i) => ({
      id: "h" + i, goal: "任务目标名称比较长的示例用于测试溢出表现" + i, status: "done",
      summary: "完成摘要", startedAt: Date.now() - i * 100000, finishedAt: Date.now(), recoveries: 0, replans: 0,
      logs: [], stepEvents: [],
    })),
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
    await b.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK }, sessionId);
    await b.send("Page.navigate", { url: SIDEPANEL }, sessionId);
    await new Promise((r) => setTimeout(r, 1200));
    await evalJs(b, sessionId, "document.getElementById('historyToggle').click(); true");
    await new Promise((r) => setTimeout(r, 400));

    const widths = [340, 320, 300, 260, 240];
    let allOk = true;
    for (const w of widths) {
      await b.send("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
      await new Promise((r) => setTimeout(r, 200));
      const m = await evalJs(b, sessionId, `(() => {
        const ov = (el) => el ? el.scrollWidth > el.clientWidth + 1 : false;
        const head = document.querySelector('.history-head');
        const actions = document.querySelector('.history-actions');
        const item = document.querySelector('.history-item');
        const itemHead = document.querySelector('.history-item-head');
        return {
          headOverflow: ov(head), actionsOverflow: ov(actions),
          itemOverflow: ov(item), itemHeadOverflow: ov(itemHead),
        };
      })()`);
      const ok = !m.headOverflow && !m.actionsOverflow && !m.itemOverflow && !m.itemHeadOverflow;
      check(ok, "width " + w + " history no overflow (head=" + m.headOverflow + " actions=" + m.actionsOverflow + " item=" + m.itemOverflow + " itemHead=" + m.itemHeadOverflow + ")");
      if (!ok) allOk = false;
    }
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== HISTORY LAYOUT ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
