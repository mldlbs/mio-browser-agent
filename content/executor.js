// DOM action executor. Receives { name, target, args }, relocates target via locator.
function setNativeValue(el, value) {
  let proto;
  if (el.tagName === "TEXTAREA") proto = HTMLTextAreaElement.prototype;
  else if (el.tagName === "INPUT") proto = HTMLInputElement.prototype;
  else return { ok: false, error: `cannot set value on <${el.tagName.toLowerCase()}> (not an input/textarea)` };
  const setter = Object.getOwnPropertyDescriptor(proto, "value");
  if (!setter || !setter.set) return { ok: false, error: `cannot set value on <${el.tagName.toLowerCase()}>` };
  setter.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Insert text in small chunks with a random per-chunk delay, mimicking a human
// typist. Bulk execCommand inserts are a common automation fingerprint and get
// flagged by bot detection (e.g. Reddit). Chunking + jitter keeps the native
// beforeinput/input pipeline that ProseMirror/React editors sync from, while
// looking natural in event timing.
async function typeIntoEditor(el, text) {
  el.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  const chars = String(text).split("");
  let i = 0;
  while (i < chars.length) {
    // 1-4 chars per burst, 30-90ms pause between bursts.
    const burst = Math.min(chars.length - i, rand(1, 4));
    document.execCommand("insertText", false, chars.slice(i, i + burst).join(""));
    i += burst;
    await sleepMs(rand(30, 90));
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Set contenteditable text the way real browsers do: focus + place caret +
// execCommand("insertText"). This fires the native beforeinput/input pipeline
// that ProseMirror/React rich editors sync their INTERNAL state from. Plain
// textContent writes leave that state stale, which keeps send/submit buttons
// disabled and makes el.click() a silent no-op (the root cause of "typed but
// message never sent" on chat sites).
async function setContentEditable(el, text, clear) {
  try {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    if (clear) {
      document.execCommand("delete");
    }
    await typeIntoEditor(el, text);
    return { ok: true };
  } catch (_) {
    // Fallback: textContent write + manual InputEvent (older editors).
    if (clear) el.textContent = "";
    el.textContent = (el.textContent || "") + text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return { ok: true };
  }
}

function doClick(el, clickCount) {
  // A disabled button swallows .click() silently. Report it as a real error so
  // the recovery engine can act (retry snapshot / vision) instead of pretending
  // the send succeeded — this was the silent "clicked but nothing happened".
  if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("disabled") != null) {
    return { ok: false, error: "element is disabled (aria/disabled); likely internal editor state not synced", errorCode: "ELEMENT_DISABLED" };
  }
  if (clickCount > 1) {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
  } else {
    el.click();
  }
  return { ok: true, value: `clicked ${el.tagName.toLowerCase()}` };
}

// Click at viewport coordinates (x, y) with a full mousedown/mouseup/click
// sequence. Bypasses snapshot-based DOM location entirely, so it works when the
// target exists but the locator cannot find it (dynamic/canvas/overlay content).
// Uses elementFromPoint so the event lands on whatever the user actually sees.
// Also dispatches pointerdown/pointerup: modern UIs (React, web components)
// often listen for pointer events, not mouse events.
function clickAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return { ok: false, error: `no element at viewport (${x}, ${y})` };
  if (el.disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("disabled") != null) {
    return { ok: false, error: "element at point is disabled", errorCode: "ELEMENT_DISABLED" };
  }
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
  return { ok: true, value: `clicked at (${x}, ${y})` };
}

async function executeAction(action) {
  const { name, target, args } = action;
  if (name === "scroll") {
    window.scrollBy({ top: args.delta, behavior: "auto" });
    return { ok: true, value: `scrolled by ${args.delta}px` };
  }
  if (name === "navigate") {
    location.href = args.url;
    return { ok: true, value: `navigating to ${args.url}`, pendingNavigation: true };
  }
  if (name === "extract_text") {
    return extractPageText(args.maxChars || 4000);
  }
  if (name === "paste") {
    const el = locateElement(target);
    if (!el) return { ok: false, error: "element not found by locator" };
    return await pasteText(el, args.text || "", args.clear);
  }
  if (name === "clickAt") {
    if (typeof args.x !== "number" || typeof args.y !== "number") {
      return { ok: false, error: "clickAt requires numeric x and y (viewport coordinates)" };
    }
    return clickAt(args.x, args.y);
  }
  if (name === "waitFor") {
    return waitForCondition(args || {});
  }
  let el = locateElement(target);
  if (!el) return { ok: false, error: "element not found by locator" };
  if (name === "click") {
    const res = doClick(el, args.clickCount || 1);
    if (!res.ok) return res;
    return { ok: true, value: `clicked ${target.name}` };
  }
  if (name === "type") {
    const editable = resolveEditable(el);
    if (!editable) return { ok: false, error: `no editable element near <${el.tagName.toLowerCase()}>` };
    el = editable;
    el.focus();
    if (el.isContentEditable) {
      await setContentEditable(el, args.text, !!args.clear);
    } else {
      if (args.clear) {
        const cleared = setNativeValue(el, "");
        if (!cleared.ok) return cleared;
      }
      const typed = setNativeValue(el, (el.value || "") + args.text);
      if (!typed.ok) return typed;
    }
    return { ok: true, value: `typed into ${target.name}` };
  }
  return { ok: false, error: `unknown action: ${name}` };
}

// Read the exact bitmap of a captcha canvas/img element as a PNG data URL. A
// full-page screenshot renders a small verification code as a few dozen pixels;
// toDataURL() hands the vision model the crisp captcha pixels directly.
function readCanvasBitmap(target) {
  let el = null;
  if (target && (target.cssPath || target.xpath || target.role || target.boundingBox)) {
    el = locateElement(target);
  }
  if (!el) el = findCaptchaElement();
  if (!el) return { ok: false, error: "no captcha canvas/img found on page" };
  try {
    let dataUrl;
    if (el.tagName === "CANVAS") {
      dataUrl = el.toDataURL();
    } else if (el.tagName === "IMG") {
      const c = document.createElement("canvas");
      c.width = el.naturalWidth || el.width || 100;
      c.height = el.naturalHeight || el.height || 40;
      c.getContext("2d").drawImage(el, 0, 0);
      dataUrl = c.toDataURL();
    } else {
      return { ok: false, error: `captcha element is <${el.tagName.toLowerCase()}>` };
    }
    if (!dataUrl || dataUrl.length < 64) return { ok: false, error: "captcha bitmap empty" };
    return { ok: true, value: dataUrl };
  } catch (e) {
    return { ok: false, error: "captcha bitmap failed: " + ((e && e.message) || String(e)) };
  }
}

function findCaptchaElement() {
  const cands = Array.from(document.querySelectorAll("canvas,img"));
  for (const el of cands) {
    const cls = ((el.getAttribute && el.getAttribute("class")) || "").toLowerCase();
    const alt = ((el.getAttribute && el.getAttribute("alt")) || "").toLowerCase();
    if (/captcha|verify|验证码|rand|code/.test(cls) || /captcha|验证码/.test(alt)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.width <= 300 && r.height <= 160) return el;
  }
  return null;
}

// Extract readable page text (title, url, trimmed body text), capped at maxChars.
function extractPageText(maxChars) {
  const body = document.body;
  if (!body) return { ok: true, value: "Page has no body text" };
  // Prefer the largest common article container if present.
  const candidates = ["article", "main", "[role='main']", ".content", "#content"];
  let root = null;
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 200) { root = el; break; }
  }
  if (!root) root = body;
  // Strip script/style/header/footer/nav noise.
  const clone = root.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,header,footer,nav,form,iframe,svg").forEach((n) => n.remove());
  let text = (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  // Append readable text from same-origin iframes (common for rich editors).
  const frames = [];
  try {
    Array.from(document.querySelectorAll("iframe")).forEach((iframe) => {
      if (!iframe.contentDocument || !iframe.contentDocument.body) return;
      const t = (iframe.contentDocument.body.innerText || "").trim();
      if (t) frames.push(t);
    });
  } catch (_) { /* cross-origin iframes are skipped */ }
  if (frames.length && text.length < maxChars) {
    text = (text + "\n\n[iframe]\n" + frames.join("\n\n")).trim();
  }
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…(truncated)";
  return { ok: true, value: { url: location.href, title: document.title, text } };
}

// Some rich editors overlay toolbar buttons on/near the input region; a
// rect-based locator can resolve to the button instead of the editor field.
// Walk up from the located element, then fall back to the nearest editable
// element in the same container so paste/type still land in the editor.
function resolveEditable(el) {
  if (!el) return null;
  if (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    return el;
  }
  let node = el;
  while (node && node !== document.body) {
    if (node.isContentEditable) return node;
    node = node.parentElement;
  }
  if (!el.closest) return null;
  const root = el.closest("[role='textbox'],[contenteditable='true'],form,.editor,.ProseMirror") || document.body;
  const editable = Array.from(root.querySelectorAll("textarea,input,[contenteditable='true'],[role='textbox']"))
    .filter((cand) => cand.offsetParent !== null || cand.getClientRects().length > 0);
  if (!editable.length) return null;
  const elRect = el.getBoundingClientRect();
  let best = null;
  let bestDist = Infinity;
  editable.forEach((cand) => {
    const r = cand.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const d = Math.hypot(cx - (elRect.x + elRect.width / 2), cy - (elRect.y + elRect.height / 2));
    if (d < bestDist) { bestDist = d; best = cand; }
  });
  // Only adopt the nearest editable if it is plausibly the intended field;
  // otherwise report failure so the recovery engine retries with a fresh
  // snapshot instead of typing into some unrelated input far away.
  return bestDist < 300 ? best : null;
}

// Paste large text into an element (contenteditable or textarea/input).
async function pasteText(el, text, clear) {
  const target = resolveEditable(el);
  if (!target) return { ok: false, error: `no editable element near <${el.tagName.toLowerCase()}>` };
  el = target;
  const wrapped = Array.isArray(text) ? text.join("\n") : String(text);
  el.focus();
  if (el.isContentEditable) {
    await setContentEditable(el, wrapped, !!clear);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: `pasted ${wrapped.length} chars` };
  } else if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    if (clear) setNativeValue(el, wrapped);
    else setNativeValue(el, (el.value || "") + wrapped);
  } else {
    return { ok: false, error: `cannot paste into <${el.tagName.toLowerCase()}>` };
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: `pasted ${wrapped.length} chars` };
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Poll until a condition is met or timeout. Returns the satisfied state.
// args: { selector?, text?, urlContains?, disappear?, timeout }
function waitForCondition(args) {
  const timeout = Math.max(0, args.timeout || 8000);
  const start = Date.now();
  const matches = (doc) => {
    if (args.selector) {
      const found = doc.querySelector(args.selector) != null;
      if (args.disappear && !found) return true;
      if (!args.disappear && found) return true;
    }
    if (args.text) {
      const has = (doc.body && doc.body.innerText && doc.body.innerText.includes(args.text)) || false;
      if (args.disappear && !has) return true;
      if (!args.disappear && has) return true;
    }
    if (args.urlContains) {
      const has = location.href.includes(args.urlContains);
      if (args.disappear && !has) return true;
      if (!args.disappear && has) return true;
    }
    return false;
  };
  const check = () => {
    if (matches(document)) return true;
    // Same-origin iframes count too.
    let any = false;
    try {
      Array.from(document.querySelectorAll("iframe")).forEach((f) => {
        if (f.contentDocument && matches(f.contentDocument)) any = true;
      });
    } catch (_) { /* cross-origin skipped */ }
    return any;
  };
  return (async () => {
    let saw = check();
    while (!saw && Date.now() - start < timeout) {
      await sleepMs(300);
      saw = check();
    }
    const waited = Date.now() - start;
    return saw
      ? { ok: true, value: `condition satisfied after ${waited}ms` }
      : { ok: false, error: `timeout after ${waited}ms waiting for condition`, errorCode: "WAIT_TIMEOUT" };
  })();
}

if (typeof module !== "undefined") {
  module.exports = { executeAction, setNativeValue, setContentEditable, resolveEditable, extractPageText, pasteText, waitForCondition, clickAt };
}
