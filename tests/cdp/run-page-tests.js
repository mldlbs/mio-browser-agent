"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const { launchChrome } = require("./launch");
const { openTab, runInPage, report } = require("./page-runner");

(async () => {
  const testPageUrl = pathToFileURL(path.resolve(__dirname, "../test-page.html")).href;
  const launched = await launchChrome();
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

      // Shadow DOM：open shadow root 内元素可快照 + 定位 + 点击
      const sbtn = snap.elements.find((e) => e.name.includes("幽灵按钮"));
      check(!!sbtn && sbtn.shadowPath.length >= 1, "snapshot finds button inside open shadow root", sbtn && JSON.stringify(sbtn.shadowPath));
      const sinput = snap.elements.find((e) => e.placeholder === "shadow输入框");
      check(!!sinput && sinput.shadowPath.length >= 1, "snapshot finds input inside open shadow root", sinput && JSON.stringify(sinput.shadowPath));
      const sLoc = locateElement(sbtn);
      check(!!sLoc && sLoc.id === "shadow-btn", "locator round-trips shadow element via cssPath", sLoc && sLoc.id);
      window.__shadowClicks = 0;
      const sClick = executeAction({ name: "click", target: sbtn, args: {} });
      check(sClick.ok && window.__shadowClicks === 1, "executor clicks button inside shadow root", sClick.ok);

      // Canvas captcha：快照收录 + 可定位 + 可点击（登录验证码场景）
      const cap = snap.elements.find((e) => e.tag === "canvas");
      check(!!cap, "snapshot captures canvas captcha element", cap && JSON.stringify(cap));
      const capEl = locateElement(cap);
      check(!!capEl && capEl.id === "captcha-canvas", "locator round-trips canvas element", capEl && capEl.id);
      window.__captchaClicks = 0;
      const capClick = executeAction({ name: "click", target: cap, args: {} });
      check(capClick.ok && window.__captchaClicks === 1, "executor clicks canvas captcha", capClick.ok);

      return out;
    `);
    const fails = report(results);
    if (fails > 0) process.exit(1);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("PAGE TESTS FAIL: " + e.message); process.exit(1); });
