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
      // Scene Graph 轻量版：表单元素带 group（语义容器），同组元素共享容器标识
      const ffUserEl = snap.elements.find((e) => e.role === "textbox" && e.name.includes("用户名"));
      check(!!ffUserEl && /form#login-form/.test(ffUserEl.group || ""), "snapshot tags form controls with their semantic group", ffUserEl && ffUserEl.group);
      const loginBtnEl = snap.elements.find((e) => e.role === "button" && e.name.includes("登录") && (e.group || "").includes("login-form"));
      check(!!loginBtnEl, "login button shares the same group as its form fields");

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

      // form_fill: batch fill + submit in one call
      const ffFields = { username: "alice", password: "s3cret", city: { select: "上海" }, agree: true };
      const ffRes = await executeAction({ name: "form_fill", target: null, args: { fields: ffFields, submit: true } });
      const ffUser = document.getElementById("ff-username");
      const ffPass = document.getElementById("ff-password");
      const ffCity = document.getElementById("ff-city");
      const ffAgree = document.getElementById("ff-agree");
      check(ffRes.ok && ffUser.value === "alice" && ffPass.value === "s3cret", "form_fill fills text fields", JSON.stringify(ffRes));
      check(ffCity.selectedIndex === 1 && ffCity.options[1].text === "上海", "form_fill selects by option text", ffCity.value);
      check(ffAgree.checked === true, "form_fill checks checkbox", String(ffAgree.checked));
      check(window.__ffSubmitted === 1, "form_fill submit clicked the submit button", String(window.__ffSubmitted));
      const ffMiss = await executeAction({ name: "form_fill", target: null, args: { fields: { nosuchkey: "x", username: "bob" } } });
      check(!ffMiss.ok && ffMiss.errorCode === "FIELD_NOT_FOUND", "form_fill reports FIELD_NOT_FOUND", JSON.stringify(ffMiss));
      check(ffUser.value === "bob", "form_fill keeps filled fields on partial failure", ffUser.value);

      // {select:""} placeholder value is refused, not selected
      ffCity.selectedIndex = 0;
      const ffEmptySel = await executeAction({ name: "form_fill", target: null, args: { fields: { city: { select: "" } } } });
      check(!ffEmptySel.ok && String(ffEmptySel.error).includes("placeholder"), "form_fill refuses empty select value", JSON.stringify(ffEmptySel));
      check(ffCity.selectedIndex === 0, "form_fill empty select keeps placeholder", ffCity.value);

      // submit stays in the filled form's scope: filling login-form must NOT
      // click second-form's submit button even though it appears later in DOM.
      window.__ffSubmitted = 0; window.__ffSubmitted2 = 0;
      const ffScope = await executeAction({ name: "form_fill", target: null, args: { fields: { username: "scoped" }, submit: true } });
      check(ffScope.ok && window.__ffSubmitted === 1, "form_fill submit scoped to the filled form", JSON.stringify(ffScope));
      check(window.__ffSubmitted2 === 0, "form_fill does not click the other form's submit", String(window.__ffSubmitted2));

      // weak keyword "ok" no longer triggers submit: second-form has an "OK"
      // button (type=button, not submit). Filling it must use the native submit.
      window.__ffSubmitted2 = 0;
      const ffOk = await executeAction({ name: "form_fill", target: null, args: { fields: { email: "a@b.com" }, submit: true } });
      check(ffOk.ok && window.__ffSubmitted2 === 1, "form_fill uses native submit, not the OK button", JSON.stringify(ffOk));

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

      // 嵌套 shadow：3 层穿透（document → root → root）快照/定位/点击/输入
      const nsBtn = snap.elements.find((e) => e.name && e.name.includes("嵌套幽灵按钮"));
      check(!!nsBtn && nsBtn.shadowPath.length === 2, "snapshot captures nested shadow button (shadowPath depth 2)", nsBtn && JSON.stringify(nsBtn.shadowPath));
      const nsInput = snap.elements.find((e) => e.placeholder === "嵌套shadow输入框");
      check(!!nsInput && nsInput.shadowPath.length === 2, "snapshot captures nested shadow input", nsInput && JSON.stringify(nsInput.shadowPath));
      const nsLoc = locateElement(nsBtn);
      check(!!nsLoc && nsLoc.id === "nested-btn", "locator resolves nested shadow element via cssPath shadowPath", nsLoc && nsLoc.id);
      window.__nestedClicks = 0;
      const nsClick = await executeAction({ name: "click", target: nsBtn, args: {} });
      check(nsClick.ok && window.__nestedClicks === 1, "executor clicks button 2 levels deep in shadow", nsClick.ok);
      const nsType = await executeAction({ name: "type", target: nsInput, args: { text: "deep", clear: true } });
      const nsInputEl = document.getElementById("nested-shadow-host").shadowRoot.getElementById("shadow-inner-host").shadowRoot.getElementById("nested-input");
      check(nsType.ok && nsInputEl.value === "deep", "executor types into nested shadow input", nsInputEl && nsInputEl.value);

      // shadow 表单：form_fill 一次填完并提交
      window.__shadowFormSubmitted = 0;
      const ffShadowRes = await executeAction({ name: "form_fill", target: null, args: { fields: { "shadow用户名": "shadowu", "shadow密码": "shadowp", "同意shadow": true }, submit: true } });
      const shadowForm = document.getElementById("shadow-form-host").shadowRoot.getElementById("shadow-form");
      const sfUser = shadowForm.querySelector("#sf2-username");
      const sfPass = shadowForm.querySelector("#sf2-password");
      const sfAgree = shadowForm.querySelector("#sf2-agree");
      check(ffShadowRes.ok && sfUser.value === "shadowu" && sfPass.value === "shadowp", "form_fill fills shadow form fields", JSON.stringify(ffShadowRes));
      check(sfAgree.checked === true, "form_fill checks checkbox inside shadow root", String(sfAgree.checked));
      check(window.__shadowFormSubmitted === 1, "form_fill submits the shadow form", String(window.__shadowFormSubmitted));

      // waitForCondition text inside shadow root is detected
      const wfShadow = await executeAction({ name: "waitFor", target: null, args: { text: "shadow登录", timeout: 500 } });
      check(wfShadow.ok, "waitForCondition finds text inside open shadow root", (wfShadow && wfShadow.error) || "");

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
      // Out-of-viewport coordinates return CLICK_OUT_OF_VIEWPORT, not a silent miss.
      const vw = window.innerWidth, vh = window.innerHeight;
      const outRes = await executeAction({ name: "clickAt", target: null, args: { x: vw + 500, y: vh + 500 } });
      check(!outRes.ok && outRes.errorCode === "CLICK_OUT_OF_VIEWPORT", "clickAt reports out-of-viewport coords", (outRes && outRes.error) || "");

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

      // Same-origin iframe: elements are snapshotted, locatable via framePath,
      // and operable cross-document from the main frame's content script.
      const iframe = document.getElementById("frame-box");
      check(!!iframe, "test page has a same-origin iframe");
      const snapF = captureSnapshot();
      const fBtn = snapF.elements.find((e) => e.name && e.name.includes("iframe按钮"));
      check(!!fBtn && Array.isArray(fBtn.framePath) && fBtn.framePath.length >= 1, "snapshot captures iframe button with framePath", fBtn && JSON.stringify(fBtn.framePath));
      const fInput = snapF.elements.find((e) => e.placeholder === "iframe输入框");
      check(!!fInput && fInput.framePath.length >= 1, "snapshot captures iframe input with framePath", fInput && JSON.stringify(fInput.framePath));
      const fBtnEl = locateElement(fBtn);
      check(!!fBtnEl && fBtnEl.id === "frame-btn", "locator resolves iframe element via framePath", fBtnEl && fBtnEl.id);
      const fClick = await executeAction({ name: "click", target: fBtn, args: {} });
      const fClicks = (iframe.contentWindow && iframe.contentWindow.__frameClicks) || 0;
      check(fClick.ok && fClicks === 1, "executor clicks iframe button (cross-document)", fClick.ok + " clicks=" + fClicks);
      const fType = await executeAction({ name: "type", target: fInput, args: { text: "hi", clear: true } });
      const fVal = iframe.contentWindow && iframe.contentWindow.document.getElementById("frame-input").value;
      check(fType.ok && fVal === "hi", "executor types into iframe input (cross-document)", fVal);

      // scroll: reaching the bottom reports a boundary signal instead of a
      // silent no-op, so the agent stops blind scrolling (was a 500kpx loop).
      const bottomScroll = await executeAction({ name: "scroll", target: null, args: { delta: 1000000 } });
      const bottomSignal = (bottomScroll.ok && /bottom/.test(bottomScroll.value || "")) || (!bottomScroll.ok && bottomScroll.errorCode === "SCROLL_AT_END");
      check(bottomSignal, "scroll at bottom yields a boundary signal", JSON.stringify(bottomScroll));
      const overScroll = await executeAction({ name: "scroll", target: null, args: { delta: 500 } });
      check(!overScroll.ok && overScroll.errorCode === "SCROLL_AT_END", "scroll past bottom returns SCROLL_AT_END", (overScroll && overScroll.error) || "");

      // dismissModal: 点击关闭控件关掉弹窗（recovery 动作 dismiss_modal 的 content 端）
      document.getElementById("modal-box").style.display = "flex";
      const dmRes = await executeAction({ name: "dismissModal", target: null, args: {} });
      const modalGone = document.getElementById("modal-box").style.display === "none";
      const closedCount = window.__modalClosed || 0;
      check(dmRes.ok && modalGone && closedCount === 1, "dismissModal clicks the close control to close the modal", JSON.stringify(dmRes) + " closed=" + closedCount);
      // 关闭后背后的按钮应可点击（弹窗不再遮挡）
      const behindRes = await executeAction({ name: "click", target: { role: "button", name: "弹窗背后的按钮" }, args: {} });
      const behindClicks = window.__behindModalClicks || 0;
      check(behindRes.ok && behindClicks === 1, "modal-occluded button clickable after dismiss", behindRes.ok + " clicks=" + behindClicks);

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
