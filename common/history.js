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

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

if (typeof module !== "undefined") {
  module.exports = { HISTORY_KEY, MAX_RECORDS, normalizeRecord, getHistory, addHistoryRecord, clearHistory };
} else {
  globalThis.HistoryModule = {
    HISTORY_KEY,
    MAX_RECORDS,
    normalizeRecord,
    getHistory,
    addHistoryRecord,
    clearHistory,
  };
}
