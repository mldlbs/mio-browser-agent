// Multi-strategy element relocation. Strategy order: xpath → role+name → rect.
// iframe-aware: target.framePath (array of iframe indexes) selects the document.
// shadow.js 先于本文件注入（manifest 保证）；独立测试页若不加载则降级为空工具
const shadowTools = (typeof require === "function" ? require("./shadow.js") : globalThis.shadowTools)
  || { collectOpenShadowRoots: () => [], walkShadowTree: () => {}, findElementInShadows: () => null };
function resolveFrameDoc(framePath) {
  let doc = document;
  (framePath || []).forEach((fi) => {
    const iframe = doc.querySelectorAll("iframe")[fi];
    if (!iframe || !iframe.contentDocument) return;
    doc = iframe.contentDocument;
  });
  return doc;
}

// Descend through open shadow roots. shadowPath is an array of host cssPaths
// (collected by snapshot.js); querySelector works on both documents and
// ShadowRoots, so nested shadows (root inside root) resolve correctly —
// unlike XPath evaluate(), which ShadowRoot does not expose.
function resolveShadowPath(root, shadowPath) {
  let container = root;
  for (const hostCss of shadowPath || []) {
    if (!container || typeof container.querySelector !== "function") return null;
    const host = findByCssPath(hostCss, container);
    if (!host || !host.shadowRoot || host.shadowRoot.mode !== "open") return null;
    container = host.shadowRoot;
  }
  return container;
}

function resolveTargetRoot(target) {
  const base = resolveFrameDoc(target && target.framePath);
  return resolveShadowPath(base, target && target.shadowPath) || base;
}

function findByXPath(xpath, doc) {
  doc = doc || document;
  if (!doc || typeof doc.evaluate !== "function") return null;
  try {
    const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    const node = result && result.singleNodeValue;
    return node && node.nodeType === 1 ? node : null;
  } catch (_) { return null; }
}

function findByCssPath(cssPath, doc) {
  doc = doc || document;
  if (!doc || typeof doc.querySelector !== "function" || !cssPath) return null;
  try {
    return doc.querySelector(cssPath);
  } catch (_) { return null; }
}

function findByName(role, name, doc) {
  doc = doc || document;
  const scan = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter((el) => !hasInteractiveDescendant(el) && isVisible(el) && computeRole(el) === role);
  };
  const matches = scan(doc);
  for (const root of shadowTools.collectOpenShadowRoots(doc)) {
    for (const el of scan(root)) {
      if (!matches.some((m) => m === el)) matches.push(el);
    }
  }
  const exact = matches.find((el) => computeAccessibleName(el) === name);
  if (exact) return exact;
  const prefix = matches.find((el) => {
    const n = computeAccessibleName(el);
    return n && (n.startsWith(name) || name.startsWith(n));
  });
  if (prefix) return prefix;
  if (name.length < 2) return null;
  return matches.find((el) => {
    const n = computeAccessibleName(el);
    return n && (n.includes(name) || name.includes(n));
  }) || null;
}

function findByRect(target, doc) {
  doc = doc || document;
  const cx = target.boundingBox.x + target.boundingBox.w / 2;
  const cy = target.boundingBox.y + target.boundingBox.h / 2;
  const scan = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter((el) => !hasInteractiveDescendant(el) && isVisible(el));
  };
  const all = scan(doc);
  for (const root of shadowTools.collectOpenShadowRoots(doc)) {
    for (const el of scan(root)) {
      if (!all.some((m) => m === el)) all.push(el);
    }
  }
  let best = null;
  let bestDist = Infinity;
  all.forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
    if (d < bestDist) { bestDist = d; best = el; }
  });
  return bestDist < 150 ? best : null;
}

function locateElement(target) {
  if (!target) return null;
  const root = resolveTargetRoot(target);
  if (!root) return null;
  if (target.cssPath) {
    const el = findByCssPath(target.cssPath, root);
    if (el) return el;
  }
  if (target.xpath) {
    const el = findByXPath(target.xpath, root);
    if (el) return el;
  }
  if (target.role && target.name) {
    const el = findByName(target.role, target.name, root);
    if (el) return el;
  }
  if (target.boundingBox) {
    const el = findByRect(target, root);
    if (el) return el;
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { locateElement, findByXPath, findByCssPath, findByName, findByRect, resolveFrameDoc, resolveShadowPath, resolveTargetRoot };
}
