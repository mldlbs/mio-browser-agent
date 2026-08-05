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

// Best-effort semantic name for icon-only buttons (no text, no aria-label):
// falls back to SVG <title>, then icon-ish class names, then a generic label.
function iconButtonName(el) {
  const svg = el.querySelector && el.querySelector("svg");
  if (svg) {
    const t = svg.querySelector("title");
    if (t && t.textContent.trim()) return truncate(t.textContent.trim(), 100);
    const svgAria = svg.getAttribute("aria-label");
    if (svgAria) return truncate(svgAria, 100);
  }
  const cls = (el.getAttribute && el.getAttribute("class")) || "";
  if (cls) {
    const hint = (String(cls).toLowerCase().match(/[\w-]*(?:send|submit|sendbtn|send-btn|发送|确定|confirm|go)[\w-]*/) || [])[0];
    if (hint) return truncate("图标(" + hint.replace(/[_-]+/g, " ") + ")", 100);
  }
  return "图标按钮";
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
  // Icon-only buttons and clickable boxes need a usable name; a bare "div" is
  // impossible for the agent to tell apart from other divs (→ misclicks/double-sends).
  if (tag === "button" || tag === "summary" || isClickableBox(el)) {
    return iconButtonName(el);
  }
  return tag;
}

// True for elements that behave like a button even without <button>/role="button":
// click handlers or keyboard-usable semantics (tabindex≥0) on a generic box.
function isClickableBox(el) {
  const tag = el.tagName.toLowerCase();
  if (tag !== "div" && tag !== "span") return false;
  if (el.getAttribute("onclick") || el.getAttribute("onmousedown") || el.getAttribute("onpointerdown")) return true;
  const tab = el.getAttribute("tabindex");
  if (tab != null && parseInt(tab, 10) >= 0) return true;
  return false;
}

function computeRole(el) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  if (el.isContentEditable) return "textbox";
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (isClickableBox(el)) return "button";
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

// Unique-ish CSS selector path for the element, usable via querySelector on both
// documents and ShadowRoots (which do not expose XPath evaluate()).
function buildCssPath(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.id && node.id === CSS.escape(node.id)) { parts.unshift("#" + node.id); break; }
    let part = node.tagName.toLowerCase();
    const parent = node.parentNode;
    if (parent && parent.nodeType === 1) {
      const siblings = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
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

function scanRoot(root, framePath, shadowPath, elements, visited, opts) {
  const candidates = Array.from(root.querySelectorAll(INTERACTIVE_SELECTOR));
  candidates.forEach((el) => {
    if (!isVisible(el)) return;
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
      cssPath: buildCssPath(el),
      href: href ? truncate(href, 200) : "",
      framePath: framePath || [],
      shadowPath: shadowPath || [],
    });
  });
  // Recurse into same-origin iframes (cross-origin access throws). Skipped in
  // frameOnly mode: the bridge enumerates every frame instead.
  if (!opts || opts.frames !== false) {
    Array.from(root.querySelectorAll("iframe")).forEach((iframe, fi) => {
      let idoc;
      try {
        idoc = iframe.contentDocument;
      } catch (_) { return; } // cross-origin: skip
      if (!idoc || visited.has(idoc)) return;
      visited.add(idoc);
      scanRoot(idoc, (framePath || []).concat(fi), [], elements, visited, opts);
    });
  }
  // Recurse into open shadow roots (closed roots are inaccessible by design).
  let hosts;
  try {
    hosts = Array.from(root.querySelectorAll("*")).filter((el) => el.shadowRoot && el.shadowRoot.mode === "open");
  } catch (_) { return; }
  hosts.forEach((host) => {
    const sroot = host.shadowRoot;
    if (!sroot || visited.has(sroot)) return;
    visited.add(sroot);
    scanRoot(sroot, framePath || [], (shadowPath || []).concat(buildXPath(host)), elements, visited);
  });
}

function captureSnapshot() {
  const elements = [];
  const visited = new Set();
  visited.add(document);
  scanRoot(document, [], [], elements, visited);
  annotatePositions(elements);
  return { url: location.href, title: document.title, timestamp: Date.now(), elements };
}

// Capture only the current frame's own document (no iframe recursion) — used
// when the bridge enumerates every frame via webNavigation and merges results.
function captureFrameSnapshot() {
  const elements = [];
  const visited = new Set();
  visited.add(document);
  scanRoot(document, [], [], elements, visited, { frames: false });
  annotatePositions(elements);
  return { url: location.href, title: document.title, timestamp: Date.now(), elements };
}

// Annotate elements with their spatial relation to the nearest textbox. Icon-only
// buttons (send/submit) share one generic name; position disambiguates them, e.g.
// "图标按钮" becomes "图标按钮(输入框右下)" so the agent picks the right control.
function annotatePositions(elements) {
  const inputs = elements.filter((e) => (e.role === "textbox" || e.role === "combobox") && e.boundingBox);
  if (!inputs.length) return;
  elements.forEach((e) => {
    if (!e.boundingBox) return;
    if (e.role !== "button") return;
    // Only enrich icon-ish/unnamed buttons; named buttons already self-describe.
    if (/图标/.test(e.name) || e.name === "div" || /^图标/.test(e.name)) {
      const rel = positionRelativeTo(e.boundingBox, inputs);
      if (rel) e.name = e.name + "(" + rel + ")";
    }
  });
}

function positionRelativeTo(box, inputs) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let best = null;
  let bestD = Infinity;
  for (const inp of inputs) {
    const b = inp.boundingBox;
    const d = Math.hypot(cx - (b.x + b.w / 2), cy - (b.y + b.h / 2));
    if (d < bestD) { bestD = d; best = inp; }
  }
  if (!best) return "";
  const b = best.boundingBox;
  const dx = cx - (b.x + b.w / 2);
  const dy = cy - (b.y + b.h / 2);
  const horiz = dx > 12 ? "右" : dx < -12 ? "左" : "";
  const vert = dy > 12 ? "下" : dy < -12 ? "上" : "";
  const parts = [];
  if (vert) parts.push(vert);
  if (horiz) parts.push(horiz);
  return parts.length ? "输入框" + parts.join("") : "输入框旁";
}

if (typeof module !== "undefined") {
  module.exports = { captureSnapshot, captureFrameSnapshot, computeRole, computeAccessibleName, isVisible, hasInteractiveDescendant, buildCssPath, annotatePositions };
}
