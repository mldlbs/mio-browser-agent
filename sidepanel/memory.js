function createMemory() {
  let lastSnapshot = null;
  function names(snapshot) {
    return (snapshot && snapshot.elements ? snapshot.elements : []).map((e) => `${e.role}:${e.name}`);
  }
  function remember(snapshot) {
    const prev = lastSnapshot;
    lastSnapshot = snapshot;
    if (!prev) return { added: names(snapshot), removed: [] };
    // Navigation or tab switch: the whole document changed; don't report a noisy diff.
    if (prev.url && snapshot.url && prev.url !== snapshot.url) {
      return { added: [], removed: [] };
    }
    const a = new Set(names(snapshot));
    const b = new Set(names(prev));
    return {
      added: [...a].filter((n) => !b.has(n)).slice(0, 20),
      removed: [...b].filter((n) => !a.has(n)).slice(0, 20),
    };
  }
  function getSummary() {
    if (!lastSnapshot) return "Memory: (empty)";
    return `URL: ${lastSnapshot.url} | Title: ${lastSnapshot.title} | Elements: ${lastSnapshot.elements.length}`;
  }
  return { remember, getSummary };
}

if (typeof module !== "undefined") {
  module.exports = { createMemory };
}
