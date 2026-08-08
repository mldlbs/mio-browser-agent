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

      const typeRes = await executeAction({ name: "type", target: inp, args: { text: "hello", clear: true } });
      check(typeRes.ok && document.getElementById("input-search").value === "hello", "executor types into input");

      window.__clicked = 0;
      const clickRes = await executeAction({ name: "click", target: btn, args: {} });
      check(clickRes.ok && window.__clicked === 1, "executor clicks button");

      const edRes = await executeAction({ name: "type", target: ed, args: { text: "x", clear: true } });
      check(edRes.ok && document.getElementById("box-editor").textContent === "x", "executor types into contenteditable");

      // contenteditable append behavior（clear:false）——追加到现有 textContent
      const edAppend = await executeAction({ name: "type", target: ed, args: { text: "abc", clear: false } });
      check(edAppend.ok && document.getElementById("box-editor").textContent === "xabc", "executor appends to contenteditable");

      // Shadow DOM：open shadow root 内元素可快照 + 定位 + 点击
      const sbtn = snap.elements.find((e) => e.name.includes("幽灵按钮"));
      check(!!sbtn && sbtn.shadowPath.length >= 1, "snapshot finds button inside open shadow root", sbtn && JSON.stringify(sbtn.shadowPath));
      const sinput = snap.elements.find((e) => e.placeholder === "shadow输入框");
      check(!!sinput && sinput.shadowPath.length >= 1, "snapshot finds input inside open shadow root", sinput && JSON.stringify(sinput.shadowPath));
      const sLoc = locateElement(sbtn);
      check(!!sLoc && sLoc.id === "shadow-btn", "locator round-trips shadow element via cssPath", sLoc && sLoc.id);
      window.__shadowClicks = 0;
      const sClick = await executeAction({ name: "click", target: sbtn, args: {} });
      check(sClick.ok && window.__shadowClicks === 1, "executor clicks button inside shadow root", sClick.ok);

      // Canvas captcha：快照收录 + 可定位 + 可点击（登录验证码场景）
      const cap = snap.elements.find((e) => e.tag === "canvas");
      check(!!cap, "snapshot captures canvas captcha element", cap && JSON.stringify(cap));
      const capEl = locateElement(cap);
      check(!!capEl && capEl.id === "captcha-canvas", "locator round-trips canvas element", capEl && capEl.id);
      window.__captchaClicks = 0;
      const capClick = await executeAction({ name: "click", target: cap, args: {} });
      check(capClick.ok && window.__captchaClicks === 1, "executor clicks canvas captcha", capClick.ok);

      // clickAt：按视口坐标点击（绕过 DOM 定位，vision 兑底链路）
      window.__clickedAt = 0;
      const btnRect = document.getElementById("btn-login").getBoundingClientRect();
      const cx = Math.round(btnRect.x + btnRect.width / 2);
      const cy = Math.round(btnRect.y + btnRect.height / 2);
      const atRes = await executeAction({ name: "clickAt", target: null, args: { x: cx, y: cy } });
      check(atRes.ok && window.__clickedAt === 1, "executor clicks at viewport coordinates", (atRes && atRes.error) || "");

      // vision-fallback target: visible+clickable but EXCLUDED from the snapshot
      // (no onclick/role/button tag), so the vision_locate path must find it by sight.
      const visionTarget = document.getElementById("vision-target");
      check(!!visionTarget && getComputedStyle(visionTarget).display !== "none", "vision target exists and is visible");
      const snap2 = captureSnapshot();
      check(!snap2.elements.some((e) => e.name && e.name.includes("视觉兜底目标")), "vision target is NOT in the snapshot", "target leaked into snapshot");
      window.__visionClicks = 0;
      visionTarget.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 200));
      const vtRect = visionTarget.getBoundingClientRect();
      const atVt = await executeAction({ name: "clickAt", target: null, args: { x: Math.round(vtRect.x + vtRect.width / 2), y: Math.round(vtRect.y + vtRect.height / 2) } });
      check(atVt.ok && window.__visionClicks === 1, "clickAt hits the vision-only target (pointerdown)", (atVt && atVt.error) || "");

      // readCanvasBitmap：把 canvas 位图直接交给视觉模型（比整页截图清晰）
      const cctx = document.getElementById("captcha-canvas").getContext("2d");
      cctx.fillStyle = "#fff"; cctx.fillRect(0, 0, 120, 40);
      cctx.fillStyle = "#000"; cctx.font = "24px monospace"; cctx.fillText("3K9f", 10, 28);
      const bmp = readCanvasBitmap(cap);
      check(bmp.ok && typeof bmp.value === "string" && bmp.value.startsWith("data:image/png"),
        "readCanvasBitmap returns exact canvas bitmap", (bmp && bmp.error) || (bmp.value || "").slice(0, 30));
      const bmpNo = readCanvasBitmap({ cssPath: "#no-such-el" });
      check(bmpNo.ok && bmpNo.value.startsWith("data:image/png"),
        "readCanvasBitmap auto-locates captcha when locator misses", bmpNo && bmpNo.error);

      return out;
    `);
    const fails = report(results);
    if (fails > 0) process.exit(1);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("PAGE TESTS FAIL: " + e.message); process.exit(1); });
