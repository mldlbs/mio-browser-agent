// 任务记忆（Task Memory）— 记录每个域名下用户跑过的任务，下次打开同站点在
// 「本页可做」推荐面板优先展示高频任务。纯本地 chrome.storage.local，绝不同步
// 云端（遵守"数据不出门"承诺）。纯函数 + 少量 storage 封装，可单测。
//
// 隐私约束：只存 goal 文本 + 域名；不存 URL 细节 / 日志 / 凭据。

const TASK_MEMORY_KEY = "mioTaskMemory";
const MAX_PER_DOMAIN = 20;
const MAX_TOTAL = 200;

// Extract a stable domain (hostname) from any URL. Returns "" when unparseable.
function extractDomain(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch (_) {
    const m = String(url).match(/^[^/:#?\s]+/);
    return m ? m[0] : "";
  }
}

function normalizeGoal(goal) {
  return String(goal || "").trim().slice(0, 200);
}

function normalizeEntry(e) {
  return {
    goal: normalizeGoal(e && e.goal),
    count: Math.max(1, (e && e.count) | 0) || 1,
    lastAt: (e && e.lastAt) | 0,
  };
}

// Coerce arbitrary storage payload into the canonical {domain: [entries]} shape.
function normalizeMemory(raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  for (const domain of Object.keys(src)) {
    const list = Array.isArray(src[domain]) ? src[domain].map(normalizeEntry).filter((x) => x.goal) : [];
    if (list.length) out[domain] = list;
  }
  return out;
}

// Sort entries by frequency (count desc), tie-broken by recency (lastAt desc).
function sortByFreq(list) {
  return list.slice().sort((a, b) => (b.count - a.count) || (b.lastAt - a.lastAt));
}

function getDomainGoals(memory, domain) {
  return sortByFreq((memory && memory[domain]) || []);
}

// Pure reducer: returns a NEW memory object with the goal recorded/incremented
// for the domain, deduped (same goal kept once), capped per-domain and total.
function recordGoalInMemory(memory, domain, goal) {
  const g = normalizeGoal(goal);
  if (!domain || !g) return memory;
  const m = Object.assign({}, memory);
  const list = (m[domain] || []).map(normalizeEntry);
  const idx = list.findIndex((e) => e.goal === g);
  if (idx >= 0) {
    list[idx].count += 1;
    list[idx].lastAt = Date.now();
  } else {
    list.push({ goal: g, count: 1, lastAt: Date.now() });
  }
  // Dedupe by goal (keep the entry with the highest count in case of drift).
  const byGoal = {};
  for (const e of list) {
    if (!byGoal[e.goal] || e.count > byGoal[e.goal].count) byGoal[e.goal] = e;
  }
  m[domain] = sortByFreq(Object.keys(byGoal).map((k) => byGoal[k])).slice(0, MAX_PER_DOMAIN);
  // Global cap: drop the lowest-count entries across all domains.
  let total = 0;
  for (const d of Object.keys(m)) total += m[d].length;
  if (total > MAX_TOTAL) {
    const all = [];
    for (const d of Object.keys(m)) for (const e of m[d]) all.push(Object.assign({ domain: d }, e));
    all.sort((a, b) => (a.count - b.count) || (a.lastAt - b.lastAt));
    const keep = all.slice(all.length - MAX_TOTAL);
    const fresh = {};
    for (const e of keep) {
      if (!fresh[e.domain]) fresh[e.domain] = [];
      fresh[e.domain].push({ goal: e.goal, count: e.count, lastAt: e.lastAt });
    }
    return fresh;
  }
  return m;
}

async function getMemory() {
  const raw = await chrome.storage.local.get(TASK_MEMORY_KEY);
  return normalizeMemory(raw[TASK_MEMORY_KEY]);
}

// Persist a completed task's goal under the given domain.
async function recordGoal(domain, goal) {
  const memory = await getMemory();
  const next = recordGoalInMemory(memory, domain, goal);
  await chrome.storage.local.set({ [TASK_MEMORY_KEY]: next });
  return next;
}

// Merge remembered goals (pinned on top, "常用") with heuristic suggestions.
// Dedupes by goal text; memory wins over the equivalent heuristic card.
function mergeSuggestions(memGoals, heuristicTasks, limit) {
  const seen = new Set();
  const out = [];
  const max = limit || 6;
  for (const g of memGoals || []) {
    if (seen.has(g.goal)) continue;
    seen.add(g.goal);
    out.push({ id: "memory", label: g.goal.slice(0, 24), goal: g.goal, hint: "常用", frequent: true, count: g.count });
    if (out.length >= max) return out;
  }
  for (const t of heuristicTasks || []) {
    if (seen.has(t.goal)) continue;
    seen.add(t.goal);
    out.push(t);
    if (out.length >= max) return out;
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { TASK_MEMORY_KEY, MAX_PER_DOMAIN, MAX_TOTAL, extractDomain, normalizeMemory, getDomainGoals, recordGoalInMemory, getMemory, recordGoal, mergeSuggestions };
} else {
  globalThis.TaskMemoryModule = {
    TASK_MEMORY_KEY,
    MAX_PER_DOMAIN,
    MAX_TOTAL,
    extractDomain,
    normalizeMemory,
    getDomainGoals,
    recordGoalInMemory,
    getMemory,
    recordGoal,
    mergeSuggestions,
  };
}
