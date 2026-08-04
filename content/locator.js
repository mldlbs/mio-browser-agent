// Multi-strategy element relocation. Strategy order: xpath → role+name → rect.
// iframe-aware: target.framePath (array of iframe indexes) selects the document.
function resolveFrameDoc(framePath) {
  let doc = document;
  (framePath || []).forEach((fi) => {
    const iframe = doc.querySelectorAll("iframe")[fi];
    if (!iframe || !iframe.contentDocument) return;
    doc = iframe.contentDocument;
  });
  return doc;
}

function findByXPath(xpath, doc) {
  doc = doc || document;
  try {
    const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue instanceof Element ? result.singleNodeValue : null;
  } catch (_) { return null; }
}

function findByName(role, name, doc) {
  doc = doc || document;
  const matches = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((el) => !hasInteractiveDescendant(el) && isVisible(el) && computeRole(el) === role);
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
  const matches = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((el) => !hasInteractiveDescendant(el) && isVisible(el));
  let best = null;
  let bestDist = Infinity;
  matches.forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
    if (d < bestDist) { bestDist = d; best = el; }
  });
  return bestDist < 150 ? best : null;
}

function locateElement(target) {
  if (!target) return null;
  const doc = resolveFrameDoc(target.framePath);
  if (target.xpath) {
    const el = findByXPath(target.xpath, doc);
    if (el) return el;
  }
  if (target.role && target.name) {
    const el = findByName(target.role, target.name, doc);
    if (el) return el;
  }
  if (target.boundingBox) {
    const el = findByRect(target, doc);
    if (el) return el;
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { locateElement, findByXPath, findByName, findByRect, resolveFrameDoc };
}
