const MSG = {
  SNAPSHOT_REQUEST: "SNAPSHOT_REQUEST",
  SNAPSHOT_RESPONSE: "SNAPSHOT_RESPONSE",
  ACTION_EXECUTE: "ACTION_EXECUTE",
  ACTION_RESULT: "ACTION_RESULT",
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
  const lines = [`Page: ${snapshot.url} | Title: ${snapshot.title}`];
  snapshot.elements.forEach((e) => {
    const state = [];
    if (e.value) state.push(`value="${e.value}"`);
    if (e.checked) state.push("checked");
    if (e.disabled) state.push("disabled");
    const box = e.boundingBox ? ` (${e.boundingBox.x},${e.boundingBox.y} ${e.boundingBox.w}x${e.boundingBox.h})` : "";
    const dest = e.href ? ` → ${e.href}` : "";
    lines.push(`[${e.index}] ${e.role} "${e.name}"${dest}${state.length ? " " + state.join(" ") : ""}${box}`);
  });
  return lines.join("\n");
}

if (typeof module !== "undefined") {
  module.exports = { MSG, make, snapshotToLines, snapshotStats };
}
