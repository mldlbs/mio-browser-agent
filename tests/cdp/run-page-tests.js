"use strict";
const path = require("path");
const { launchChrome } = require("./launch");
const { openTab, runInPage, report } = require("./page-runner");

(async () => {
  const testPageUrl = "file:///" + path.resolve(__dirname, "../test-page.html").replace(/\\/g, "/");
  const launched = await launchChrome({ url: testPageUrl });
  try {
    const { sessionId } = await openTab(launched.browser, testPageUrl);
    const results = await runInPage(launched.browser, sessionId, `
      const out = [];
      const check = (cond, name, detail) => out.push({ ok: !!cond, name, detail });

      const snap = captureSnapshot();
      check(snap.elements.length >= 4, "snapshot captures >= 4 interactive elements", "got " + snap.elements.length);
      const btn = snap.elements.find((e) => e.role === "button" && e.name.includes("登录"));
      check(!!btn, "snapshot finds login button");
      const inp = snap.elements.find((e) => e.role === "textbox" && e.placeholder);
      check(!!inp, "snapshot finds textbox with placeholder");
      const ed = snap.elements.find((e) => e.role === "textbox" && e.tag === "div");
      check(!!ed, "snapshot finds contenteditable as textbox");

      const el = locateElement(btn);
      check(!!el && el.id === "btn-login", "locator round-trips snapshot element", el && el.id);

      const typeRes = executeAction({ name: "type", target: inp, args: { text: "hello", clear: true } });
      check(typeRes.ok && document.getElementById("input-search").value === "hello", "executor types into input");

      window.__clicked = 0;
      const clickRes = executeAction({ name: "click", target: btn, args: {} });
      check(clickRes.ok && window.__clicked === 1, "executor clicks button");

      const edRes = executeAction({ name: "type", target: ed, args: { text: "x", clear: true } });
      check(edRes.ok && document.getElementById("box-editor").textContent === "x", "executor types into contenteditable");

      // contenteditable append behavior（clear:false）——追加到现有 textContent
      const edAppend = executeAction({ name: "type", target: ed, args: { text: "abc", clear: false } });
      check(edAppend.ok && document.getElementById("box-editor").textContent === "xabc", "executor appends to contenteditable");

      return out;
    `);
    const fails = report(results);
    if (fails > 0) process.exit(1);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("PAGE TESTS FAIL: " + e.message); process.exit(1); });
