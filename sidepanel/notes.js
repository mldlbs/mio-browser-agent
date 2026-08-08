// Session notes - cross-tab / cross-site memory for a running task.
// Lets the agent stash data (captcha codes, prices, extracted ids) and read it
// back after switching tabs, even after history trimming drops it from context.
// Pure data + serialization (unit-testable).

function createNotes(initial) {
  const notes = new Map();
  if (initial && typeof initial === "object") {
    for (const [k, v] of Object.entries(initial)) {
      if (typeof v === "string") notes.set(k, v);
    }
  }
  return {
    set(key, value) {
      notes.set(String(key), String(value).slice(0, 2000));
      return true;
    },
    get(key) {
      return notes.has(String(key)) ? notes.get(String(key)) : null;
    },
    list() {
      return [...notes.entries()].map(([k, v]) => ({ key: k, value: v }));
    },
    clear() {
      notes.clear();
      return true;
    },
    remove(key) {
      return notes.delete(String(key));
    },
    size() {
      return notes.size;
    },
    // Serialize for checkpoint/resume. Entries are short key/value strings.
    toJSON() {
      return Object.fromEntries(notes.entries());
    },
    // Human-readable block injected into the LLM context each turn.
    render() {
      if (!notes.size) return "";
      const lines = [...notes.entries()].map(([k, v]) => `${k}: ${v}`);
      return "Session notes:\n" + lines.join("\n");
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { createNotes };
} else {
  globalThis.NotesModule = { createNotes };
}
