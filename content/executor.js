// DOM action executor. Receives { name, target, args }, relocates target via locator.
function setNativeValue(el, value) {
  let proto;
  if (el.tagName === "TEXTAREA") proto = HTMLTextAreaElement.prototype;
  else if (el.tagName === "SELECT") proto = HTMLSelectElement.prototype;
  else proto = HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value");
  if (!setter || !setter.set) return { ok: false, error: `cannot set value on <${el.tagName.toLowerCase()}>` };
  setter.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true };
}

function setContentEditable(el, text) {
  el.textContent = text;
  // Real InputEvent lets ProseMirror/React-rich editors sync their internal state.
  // Keep the plain input event too, for simpler contenteditables that read textContent.
  el.dispatchEvent(new Event("input", { bubbles: true }));
  try {
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  } catch (_) {
    el.dispatchEvent(new Event("input", { bubbles: true, inputType: "insertText", data: text }));
  }
}

function doClick(el, clickCount) {
  if (clickCount > 1) {
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
  } else {
    el.click();
  }
}

function executeAction(action) {
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
    return pasteText(el, args.text || "", args.clear);
  }
  if (name === "waitFor") {
    return waitForCondition(args || {});
  }
  const el = locateElement(target);
  if (!el) return { ok: false, error: "element not found by locator" };
  if (name === "click") {
    doClick(el, args.clickCount || 1);
    return { ok: true, value: `clicked ${target.name}` };
  }
  if (name === "type") {
    el.focus();
    if (el.isContentEditable) {
      if (args.clear) el.textContent = "";
      setContentEditable(el, el.textContent + args.text);
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

// Paste large text into an element (contenteditable or textarea/input).
function pasteText(el, text, clear) {
  const wrapped = Array.isArray(text) ? text.join("\n") : String(text);
  el.focus();
  if (el.isContentEditable) {
    el.textContent = clear ? wrapped : (el.textContent || "") + wrapped;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    try {
      el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: wrapped }));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: wrapped }));
    } catch (_) {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
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
  module.exports = { executeAction, setNativeValue, setContentEditable, extractPageText, pasteText, waitForCondition };
}
