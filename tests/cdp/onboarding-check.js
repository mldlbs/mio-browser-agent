"use strict";
// Verify onboarding mask: click 下一步 steps through, 开始使用 closes it,
// 跳过 closes it, and it stays hidden when the done flag is set.
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./launch");

const ROOT = path.resolve(__dirname, "..", "..");
const SIDEPANEL = pathToFileURL(path.join(ROOT, "sidepanel", "sidepanel.html")).href;

// seedDone=true pre-sets mioOnboardingDone (simulates a returning user).
function buildMock(seedDone) {
  return `
(() => {
  const store = {
    agentSettings: {
      provider: "openai", model: "gpt-4o-mini",
      baseURL: "https://api.openai.com/v1", apiKey: "k",
      maxSteps: 30, enableVision: false,
      vision: { provider: "openai", model: "", baseURL: "", apiKey: "" },
      sync: { enabled: false, serverUrl: "", lastSyncAt: 0 },
    },
    mioCustomTemplates: [],
    mioTaskHistory: [],
    mioSession: null,
    mioOnboardingDone: ${seedDone ? "true" : "undefined"},
  };
  globalThis.__mioStore = store;
  const FAKE_SNAPSHOT = {
    type: "SNAPSHOT_RESPONSE",
    payload: { snapshot: { title: "T", url: "https://example.com", elements: [
      { role: "textbox", name: "搜索", inputType: "text", placeholder: "", value: "", tag: "input", href: "", text: "" },
      { role: "button", name: "搜索", inputType: "", placeholder: "", value: "", tag: "button", href: "", text: "搜索" },
    ] } },
  };
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: "0.1.51" }), onMessage: { addListener() {} }, sendMessage: async () => {} },
    storage: { local: {
      async get(key) { return { [key]: store[key] }; },
      async set(obj) { Object.assign(store, obj); },
      async remove(key) { delete store[key]; },
    } },
    tabs: {
      query: async () => [{ id: 1, url: "https://example.com", title: "T", index: 0, windowId: 1, active: true }],
      get: async (id) => ({ id, url: "https://example.com", title: "T", index: 0, windowId: 1, active: true }),
      sendMessage: async () => FAKE_SNAPSHOT,
      onActivated: { addListener() {} }, onUpdated: { addListener() {} },
    },
    webNavigation: { getAllFrames: async () => [{ frameId: 0 }] },
    sidePanel: { close() {} }, windows: { WINDOW_ID_CURRENT: -1, update() {} },
    scripting: {}, action: {},
  };
})();`;
}

let failures = 0;
function check(cond, name) {
  console.log((cond ? "PASS: " : "FAIL: ") + name);
  if (!cond) failures++;
}

async function evalJs(browser, sessionId, expr) {
  const { result } = await browser.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (result && result.exceptionDetails) throw new Error(result.exceptionDetails.text + " " + JSON.stringify(result.exceptionDetails.exception || {}));
  return result && result.value;
}

async function openSidepanel(browser, mockSource) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Page.addScriptToEvaluateOnNewDocument", { source: mockSource }, sessionId);
  await browser.send("Page.navigate", { url: SIDEPANEL }, sessionId);
  for (let i = 0; i < 60; i++) {
    const ready = await evalJs(browser, sessionId, "document.getElementById('onboardMask') !== null");
    if (ready) return sessionId;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("sidepanel did not load");
}

async function waitFor(browser, sessionId, expr, ms) {
  const start = Date.now();
  while (Date.now() - start < (ms || 5000)) {
    try { if (await evalJs(browser, sessionId, expr)) return true; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  const launched = await launchChrome({ loadExtension: false });
  try {
    const b = launched.browser;
    // ── first-run: onboarding shows, steps, closes, persists flag ──
    let sid = await openSidepanel(b, buildMock(false));
    let shown = await waitFor(b, sid, "!document.getElementById('onboardMask').hidden", 6000);
    check(shown, "onboarding mask shows on first load");
    const btn1 = await evalJs(b, sid, "document.getElementById('onboardNext').textContent");
    check(btn1 === "下一步", "next button starts as 下一步");

    await evalJs(b, sid, "document.getElementById('onboardNext').click(); true");
    const s1 = await evalJs(b, sid, "document.querySelector('.onboard-step.active').dataset.step");
    check(s1 === "1", "first 下一步 moves to step 2");
    await evalJs(b, sid, "document.getElementById('onboardNext').click(); true");
    const s2 = await evalJs(b, sid, "document.querySelector('.onboard-step.active').dataset.step");
    check(s2 === "2", "second 下一步 moves to step 3");
    const btn3 = await evalJs(b, sid, "document.getElementById('onboardNext').textContent");
    check(btn3 === "开始使用", "next becomes 开始使用 on last step");

    await evalJs(b, sid, "document.getElementById('onboardNext').click(); true");
    const closed = await waitFor(b, sid, "document.getElementById('onboardMask').hidden", 3000);
    check(closed, "开始使用 closes the mask");
    const flag = await evalJs(b, sid, "JSON.stringify(__mioStore.mioOnboardingDone)");
    check(flag === "true", "onboarding done flag persisted");

    // ── skip path ──
    await evalJs(b, sid, "document.getElementById('onboardMask').hidden = false; document.getElementById('onboardSkip').click(); true");
    const closed2 = await waitFor(b, sid, "document.getElementById('onboardMask').hidden", 3000);
    check(closed2, "跳过 closes the mask");
  } finally {
    launched.kill();
  }

  // ── returning user (flag already set): mask stays hidden ──
  const launched2 = await launchChrome({ loadExtension: false });
  try {
    const b2 = launched2.browser;
    const sid2 = await openSidepanel(b2, buildMock(true));
    await new Promise((r) => setTimeout(r, 800));
    const hidden = await evalJs(b2, sid2, "document.getElementById('onboardMask').hidden");
    check(hidden === true, "onboarding stays hidden when done flag set");
  } finally {
    launched2.kill();
  }

  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== ONBOARDING ALL PASS ===");
}

main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
