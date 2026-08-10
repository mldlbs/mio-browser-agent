// Unified open-shadow-root traversal shared by snapshot, locator, and executor.
// open roots are accessible from content scripts; closed roots are not and are
// intentionally skipped everywhere.
function collectOpenShadowRoots(doc) {
  const roots = [];
  const seen = new Set();
  const visit = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return;
    let hosts;
    try {
      hosts = Array.from(container.querySelectorAll("*")).filter((el) => el.shadowRoot && el.shadowRoot.mode === "open");
    } catch (_) { return; }
    for (const host of hosts) {
      const sroot = host.shadowRoot;
      if (!sroot || seen.has(sroot)) continue;
      seen.add(sroot);
      roots.push(sroot);
      visit(sroot);
    }
  };
  visit(doc);
  return roots;
}

function walkShadowTree(doc, visitFn) {
  if (visitFn) visitFn(doc);
  for (const root of collectOpenShadowRoots(doc)) visitFn(root);
}

// Find an element matching `selector` across the document and every open
// shadow root (first hit wins, document checked first).
function findElementInShadows(selector, doc) {
  doc = doc || document;
  if (!doc || typeof doc.querySelector !== "function" || !selector) return null;
  try {
    const el = doc.querySelector(selector);
    if (el) return el;
  } catch (_) { /* bad selector: fall through */ }
  for (const root of collectOpenShadowRoots(doc)) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch (_) { /* keep scanning */ }
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { collectOpenShadowRoots, walkShadowTree, findElementInShadows };
} else {
  globalThis.shadowTools = { collectOpenShadowRoots, walkShadowTree, findElementInShadows };
}
