const HISTORY_KEY = "mioTaskHistory";
const MAX_RECORDS = 50;

function normalizeRecord(r) {
  return {
    id: r && r.id,
    goal: r && r.goal || "",
    status: r && r.status || "unknown",
    summary: r && r.summary || "",
    startedAt: r && r.startedAt || 0,
    finishedAt: r && r.finishedAt || 0,
    recoveries: r && r.recoveries || 0,
    replans: r && r.replans || 0,
    logs: Array.isArray(r && r.logs) ? r.logs : [],
    resume: r && r.resume || null,
    pinned: !!(r && r.pinned),
    tags: Array.isArray(r && r.tags) ? r.tags.slice(0, 8) : [],
  };
}

async function getHistory() {
  const raw = await chrome.storage.local.get(HISTORY_KEY);
  const list = raw[HISTORY_KEY];
  return Array.isArray(list) ? list.map(normalizeRecord) : [];
}

async function addHistoryRecord(record) {
  const list = await getHistory();
  list.unshift(normalizeRecord(record));
  const trimmed = list.slice(0, MAX_RECORDS);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
  return trimmed;
}

async function updateHistoryRecord(id, patch) {
  const list = await getHistory();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return list;
  list[idx] = normalizeRecord(Object.assign({}, list[idx], patch));
  await chrome.storage.local.set({ [HISTORY_KEY]: list });
  return list;
}

function sortRecords(records) {
  return records.slice().sort((a, b) => (!!b.pinned - !!a.pinned) || (b.startedAt - a.startedAt));
}

function filterRecords(records, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return sortRecords(records);
  return sortRecords(records.filter((r) =>
    r.goal.toLowerCase().includes(q) ||
    r.summary.toLowerCase().includes(q) ||
    (r.tags || []).some((t) => t.toLowerCase().includes(q))
  ));
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

if (typeof module !== "undefined") {
  module.exports = { HISTORY_KEY, MAX_RECORDS, normalizeRecord, getHistory, addHistoryRecord, updateHistoryRecord, sortRecords, filterRecords, clearHistory };
} else {
  globalThis.HistoryModule = {
    HISTORY_KEY,
    MAX_RECORDS,
    normalizeRecord,
    getHistory,
    addHistoryRecord,
    updateHistoryRecord,
    sortRecords,
    filterRecords,
    clearHistory,
  };
}
