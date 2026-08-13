const HISTORY_KEY = "mioTaskHistory";
const SESSION_KEY = "mioSession";
const LOCAL_MAX_RECORDS = 50;
// 已登录（启用云同步）时放开本地历史上限：记录全量保留在本机，服务器是异地备份。
const SYNC_MAX_RECORDS = 500;
const MAX_RECORDS = LOCAL_MAX_RECORDS;

async function isSynced() {
  if (!globalThis.chrome || !chrome.storage || !chrome.storage.local) return false;
  try {
    const raw = await chrome.storage.local.get(SESSION_KEY);
    const s = raw && raw[SESSION_KEY];
    return !!(s && s.serverUrl);
  } catch (_) { return false; }
}

async function getMaxRecords() {
  return (await isSynced()) ? SYNC_MAX_RECORDS : LOCAL_MAX_RECORDS;
}

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
    stepEvents: Array.isArray(r && r.stepEvents) ? r.stepEvents.slice(-100) : [],
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
  const trimmed = list.slice(0, await getMaxRecords());
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

async function _setRawHistory(list) {
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, await getMaxRecords()) });
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

// Build a shareable, portable snapshot of a single task record. Deliberately
// excludes resume (checkpoint/notes) so no credentials or partial state leak;
// the receiver sees only what happened, not how to continue it.
function buildShareRecord(r) {
  const rec = normalizeRecord(r);
  return {
    app: "mio",
    version: 1,
    id: rec.id,
    goal: rec.goal,
    status: rec.status,
    summary: rec.summary,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt,
    recoveries: rec.recoveries,
    replans: rec.replans,
    tags: rec.tags,
    logs: rec.logs.slice(0, 300),
  };
}

// Import records from an exported JSON (array of normalized records, or a
// single record). Merges by id: existing ids are skipped, new ids are added at
// the front, then the list is trimmed to the current cap (50 local / 500 synced).
// Returns the merged list.
async function importRecords(raw) {
  let arr = raw;
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object" && raw.id) arr = [raw];
  if (!Array.isArray(arr)) throw new Error("导入文件不是有效的记录列表");
  const list = await getHistory();
  const existing = new Set(list.map((r) => r.id));
  const incoming = [];
  for (const item of arr) {
    const rec = normalizeRecord(item);
    if (!rec.id || existing.has(rec.id)) continue;
    existing.add(rec.id);
    incoming.push(rec);
  }
  const merged = incoming.concat(list).slice(0, await getMaxRecords());
  await chrome.storage.local.set({ [HISTORY_KEY]: merged });
  return merged;
}

if (typeof module !== "undefined") {
  module.exports = { HISTORY_KEY, SESSION_KEY, LOCAL_MAX_RECORDS, SYNC_MAX_RECORDS, MAX_RECORDS, normalizeRecord, getHistory, addHistoryRecord, updateHistoryRecord, _setRawHistory, sortRecords, filterRecords, clearHistory, importRecords, buildShareRecord, isSynced, getMaxRecords };
} else {
  globalThis.HistoryModule = {
    HISTORY_KEY,
    SESSION_KEY,
    LOCAL_MAX_RECORDS,
    SYNC_MAX_RECORDS,
    MAX_RECORDS,
    normalizeRecord,
    getHistory,
    addHistoryRecord,
    updateHistoryRecord,
    _setRawHistory,
    sortRecords,
    filterRecords,
    clearHistory,
    importRecords,
    buildShareRecord,
    isSynced,
    getMaxRecords,
  };
}
