// Accessibility snapshot extractor. Pure DOM; no chrome APIs.
const INTERACTIVE_SELECTOR = [
  "a[href]", "button", "summary", "input", "textarea", "select",
  "[role]", "[tabindex]", "[contenteditable]", "[onclick]",
].join(",");

function truncate(str, max) {
  if (str == null) return "";
  str = String(str).replace(/\s+/g, " ").trim();
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function isVisible(el) {
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function textOf(el) {
  return (el.innerText || el.textContent || "").trim();
}

function labelledBy(el) {
  const id = el.getAttribute("aria-labelledby");
  if (!id) return "";
  return id.split(/\s+/).map((i) => {
    const ref = document.getElementById(i);
    return ref ? textOf(ref) : "";
  }).filter(Boolean).join(" ");
}

function associatedLabel(el) {
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l) return textOf(l);
  }
  const parent = el.closest("label");
  if (parent) return textOf(parent).replace(textOf(el), "").trim();
  return "";
}

function computeAccessibleName(el) {
  const byId = labelledBy(el);
  if (byId) return truncate(byId, 100);
  const aria = el.getAttribute("aria-label");
  if (aria) return truncate(aria, 100);
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const lbl = associatedLabel(el);
    if (lbl) return truncate(lbl, 100);
    const ph = el.getAttribute("placeholder");
    if (ph) return truncate("输入框(占位: " + ph + ")", 100);
    return "未命名输入框";
  }
  const t = textOf(el);
  if (t) return truncate(t, 100);
  const alt = el.getAttribute("alt");
  if (alt) return truncate(alt, 100);
  const title = el.getAttribute("title");
  if (title) return truncate(title, 100);
  return tag;
}

function computeRole(el) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  if (el.isContentEditable) return "textbox";
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const t = (el.type || "text").toLowerCase();
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "button" || t === "submit" || t === "reset") return "button";
    if (t === "file") return "file";
    return "textbox";
  }
  if (tag === "select") return "combobox";
  if (tag === "option") return "option";
  if (tag === "img") return "img";
  return "generic";
}

function buildXPath(el) {
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.id) { parts.unshift(`//*[@id="${node.id}"]`); break; }
    let part = node.tagName.toLowerCase();
    const parent = node.parentNode;
    if (parent) {
      const siblings = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
      if (siblings.length > 1) part += `[${siblings.indexOf(node) + 1}]`;
    }
    parts.unshift(part);
    node = parent;
  }
  return "/" + parts.join("/");
}

function hasInteractiveDescendant(el) {
  // Only direct children count as interactive containers. Non-standard nested
  // anchors (e.g. a marketplace product card containing a shop link) must NOT
  // disqualify the card itself, or whole product cards get dropped from snapshots.
  return Array.from(el.children).some((c) => c.matches && c.matches(INTERACTIVE_SELECTOR));
}

function elementValue(el) {
  if (el.isContentEditable) return el.innerText;
  if (el.tagName === "SELECT") {
    const sel = el.options[el.selectedIndex];
    return sel ? sel.text : "";
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value;
  return "";
}

function scanDocument(doc, framePath, elements) {
  const candidates = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR));
  candidates.forEach((el) => {
    if (!isVisible(el, doc)) return;
    if (hasInteractiveDescendant(el)) return;
    const r = el.getBoundingClientRect();
    const href = el.getAttribute && el.getAttribute("href");
    elements.push({
      index: elements.length,
      role: computeRole(el),
      name: computeAccessibleName(el),
      placeholder: el.getAttribute("placeholder") || "",
      value: truncate(elementValue(el), 100),
      checked: !!el.checked,
      disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true",
      visible: true,
      boundingBox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      tag: el.tagName.toLowerCase(),
      text: truncate(textOf(el), 200),
      xpath: buildXPath(el),
      href: href ? truncate(href, 200) : "",
      framePath: framePath || [],
    });
  });
  // Recurse into same-origin iframes (cross-origin access throws).
  Array.from(doc.querySelectorAll("iframe")).forEach((iframe, fi) => {
    let idoc;
    try {
      idoc = iframe.contentDocument;
    } catch (_) { return; } // cross-origin: skip
    if (!idoc) return;
    scanDocument(idoc, (framePath || []).concat(fi), elements);
  });
}

function captureSnapshot() {
  const elements = [];
  scanDocument(document, [], elements);
  return { url: location.href, title: document.title, timestamp: Date.now(), elements };
}

if (typeof module !== "undefined") {
  module.exports = { captureSnapshot, computeRole, computeAccessibleName, isVisible, hasInteractiveDescendant };
}
