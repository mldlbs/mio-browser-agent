const MSG = {
  SNAPSHOT_REQUEST: "SNAPSHOT_REQUEST",
  SNAPSHOT_RESPONSE: "SNAPSHOT_RESPONSE",
  ACTION_EXECUTE: "ACTION_EXECUTE",
  ACTION_RESULT: "ACTION_RESULT",
  CANVAS_READ_REQUEST: "CANVAS_READ_REQUEST",
  CANVAS_READ_RESPONSE: "CANVAS_READ_RESPONSE",
};

function make(type, payload) {
  return { type, payload: payload || {} };
}

function snapshotStats(snapshot) {
  if (!snapshot || !snapshot.elements) return "(no snapshot)";
  const counts = {};
  snapshot.elements.forEach((e) => { counts[e.role] = (counts[e.role] || 0) + 1; });
  const breakdown = Object.keys(counts).length
    ? Object.entries(counts)
        .map(([k, v]) => `${k}:${v}`)
        .sort((a, b) => a.localeCompare(b))
        .join(", ")
    : "empty";
  return `snapshot: ${snapshot.elements.length} elements (${breakdown}) | url: ${snapshot.url}`;
}

function snapshotToLines(snapshot) {
  if (!snapshot) return "Page: (no snapshot)\n";
  const loc = [];
  if (snapshot.tabIndex != null && snapshot.tabCount != null && snapshot.tabCount > 1) {
    loc.push(`Tab ${snapshot.tabIndex + 1}/${snapshot.tabCount}`);
  }
  loc.push(`Page: ${snapshot.url} | Title: ${snapshot.title}`);
  const lines = [loc.join(" · ")];
  if (snapshot.tabs && snapshot.tabs.length > 1) {
    const tabDesc = snapshot.tabs.map((t) => `[${t.index}] ${t.title || t.url}${t.active ? "*" : ""}`).join("  ");
    lines.push(`Tabs: ${tabDesc}`);
  }
  snapshot.elements.forEach((e) => {
    const state = [];
    if (e.value) state.push(`value="${e.value}"`);
    if (e.checked) state.push("checked");
    if (e.disabled) state.push("disabled");
    const box = e.boundingBox ? ` (${e.boundingBox.x},${e.boundingBox.y} ${e.boundingBox.w}x${e.boundingBox.h})` : "";
    const dest = e.href ? ` → ${e.href}` : "";
    const frame = e.frameId ? ` [frame ${e.frameId}]` : "";
    lines.push(`[${e.index}] ${e.role} "${e.name}"${dest}${frame}${state.length ? " " + state.join(" ") : ""}${box}`);
  });
  return lines.join("\n");
}

if (typeof module !== "undefined") {
  module.exports = { MSG, make, snapshotToLines, snapshotStats };
}
