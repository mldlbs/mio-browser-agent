"use strict";
// Verify cloud-sync auth now lives ONLY in settings (no header authBtn),
// and the settings form toggles logged-out/logged-in correctly with a mocked fetch.
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
  // Mock auth server: login/register return a fake session.
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    if (/login|register/.test(url)) {
      return { ok: true, json: async () => ({ token: "tk", email: body.email || "a@b.com", lastSyncAt: 0 }) };
    }
    return { ok: true, json: async () => ({}) };
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

    // No header auth button anymore
    const hasAuthBtn = await evalJs(b, sessionId, "document.getElementById('authBtn') !== null");
    check(hasAuthBtn === false, "header auth button removed");

    // Open settings -> logged-out form visible
    await evalJs(b, sessionId, "document.querySelector('details.settings').open = true; true");
    const outVisible = await evalJs(b, sessionId, "document.getElementById('syncLoggedOut').style.display !== 'none'");
    check(outVisible === true, "settings shows logged-out form");
    const innHidden = await evalJs(b, sessionId, "document.getElementById('syncLoggedIn').style.display === 'none'");
    check(innHidden === true, "settings hides logged-in block when logged out");

    // Fill + login -> logged-in block visible, email shown
    await evalJs(b, sessionId, `(async () => {
      document.getElementById('syncEmail').value = 'u@x.com';
      document.getElementById('syncPassword').value = 'pw';
      document.getElementById('syncLogin').click();
      await new Promise(r => setTimeout(r, 500));
      return true;
    })()`);
    const emailShown = await evalJs(b, sessionId, "document.getElementById('syncEmailDisplay').textContent");
    check(emailShown === "u@x.com", "logged-in block shows email (got " + JSON.stringify(emailShown) + ")");
    const innVisible = await evalJs(b, sessionId, "document.getElementById('syncLoggedIn').style.display !== 'none'");
    check(innVisible === true, "logged-in block visible after login");

    // Logout -> back to logged-out
    await evalJs(b, sessionId, "document.getElementById('syncLogout').click(); true");
    await new Promise((r) => setTimeout(r, 400));
    const backOut = await evalJs(b, sessionId, "document.getElementById('syncLoggedOut').style.display !== 'none'");
    check(backOut === true, "logout returns to logged-out form");
  } finally { launched.kill(); }
  if (failures) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== SETTINGS AUTH ALL PASS ===");
}
main().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
