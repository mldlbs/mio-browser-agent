// 定时/周期任务（Scheduled Tasks）— 让用户把"每天都要做"的事授权给 mio 到点自动跑。
// 纯函数调度逻辑（可单测）+ chrome.storage.local 持久化 + chrome.alarms 映射。
// 数据只存 chrome.storage.local（含 goal 文本，纯本地；由用户显式配置，非自动采集）。

const SCHEDULE_KEY = "mioSchedules";
const ALARM_PREFIX = "mio-sched-";
// chrome.alarms 最小周期 0.5 分钟；此处对 interval 强制 >=1 分钟，尊重阈值。
const MIN_INTERVAL_MIN = 1;
const MIN_ALARM_DELAY_MS = 30000;

const FREQUENCIES = ["daily", "weekly", "interval"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function normalizeSchedule(s) {
  return {
    id: (s && s.id) || "",
    goal: String((s && s.goal) || "").trim(),
    url: String((s && s.url) || "").trim(),
    frequency: FREQUENCIES.includes(s && s.frequency) ? s.frequency : "daily",
    time: String((s && s.time) || "09:00").slice(0, 5),
    weekday: ((s && s.weekday) | 0) % 7,
    intervalMinutes: Math.max(MIN_INTERVAL_MIN, Math.round((s && s.intervalMinutes) || 60)),
    enabled: !!(s && s.enabled),
    lastRunAt: (s && s.lastRunAt) | 0,
    lastStatus: String((s && s.lastStatus) || ""),
    lastSummary: String((s && s.lastSummary) || "").slice(0, 500),
    createdAt: (s && s.createdAt) | 0,
  };
}

function newScheduleId() {
  return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function alarmName(id) {
  return ALARM_PREFIX + id;
}

// "HH:MM" -> minutes since midnight; invalid -> null.
function parseTime(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

// Next occurrence of a time-of-day (in minutes) on/after `now` (epoch ms).
function nextDailyAt(now, minutes) {
  const d = new Date(now);
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let cand = base.getTime() + minutes * 60000;
  if (cand <= now) cand += 86400000;
  return cand;
}

// Next occurrence of (weekday, time-of-day) on/after `now`.
function nextWeeklyAt(now, weekday, minutes) {
  const d = new Date(now);
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let diff = (weekday - d.getDay() + 7) % 7;
  let cand = base.getTime() + diff * 86400000 + minutes * 60000;
  if (cand <= now) cand += 7 * 86400000;
  return cand;
}

// Next fire time (epoch ms) for a schedule after `now`. Returns 0 if the
// schedule has no valid next time (bad time string).
function computeNextRunAt(schedule, now) {
  const s = normalizeSchedule(schedule);
  const ts = now || Date.now();
  if (!s.goal || !s.enabled) return 0;
  if (s.frequency === "interval") return ts + s.intervalMinutes * 60000;
  const minutes = parseTime(s.time);
  if (minutes == null) return 0;
  if (s.frequency === "daily") return nextDailyAt(ts, minutes);
  return nextWeeklyAt(ts, s.weekday, minutes);
}

// Map a schedule to a chrome.alarms create() spec:
//   daily/weekly: { when: firstFire, periodInMinutes } — Chrome re-fires on the
//   period, so a single create keeps it recurring across browser restarts.
//   interval:     { periodInMinutes }
// Chrome requires `when` to be at least ~30s in the future; if computed next
// fire is too close, nudge to the following period.
function scheduleToAlarmInfo(schedule, now) {
  const s = normalizeSchedule(schedule);
  const ts = now || Date.now();
  if (s.frequency === "interval") {
    return { periodInMinutes: s.intervalMinutes };
  }
  const when = computeNextRunAt(s, ts);
  if (!when) return null;
  const periodDays = s.frequency === "weekly" ? 7 : 1;
  const periodMinutes = periodDays * 1440;
  const fireAt = when - ts < MIN_ALARM_DELAY_MS ? when + periodMinutes * 60000 : when;
  return { when: fireAt, periodInMinutes: periodMinutes };
}

// Human-readable "next run" description for the UI, e.g. "每日 09:00 · 3 分钟后".
function describeSchedule(schedule, now) {
  const s = normalizeSchedule(schedule);
  const ts = now || Date.now();
  const when = computeNextRunAt(s, ts);
  if (!when) return "已停用";
  const whenFmt = new Date(when).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const label = s.frequency === "daily" ? "每日" + s.time
    : s.frequency === "weekly" ? "每周" + WEEKDAYS[s.weekday] + " " + s.time
    : "每 " + s.intervalMinutes + " 分钟";
  return label + " · 下次 " + whenFmt;
}

// ── storage ──
async function getSchedules() {
  const raw = await chrome.storage.local.get(SCHEDULE_KEY);
  const list = raw[SCHEDULE_KEY];
  return Array.isArray(list) ? list.map(normalizeSchedule) : [];
}

async function saveSchedule(schedule) {
  const s = normalizeSchedule(schedule);
  if (!s.id) s.id = newScheduleId();
  const list = await getSchedules();
  const idx = list.findIndex((x) => x.id === s.id);
  if (idx >= 0) list[idx] = s;
  else list.push(s);
  await chrome.storage.local.set({ [SCHEDULE_KEY]: list });
  return s;
}

async function deleteSchedule(id) {
  const list = (await getSchedules()).filter((x) => x.id !== id);
  await chrome.storage.local.set({ [SCHEDULE_KEY]: list });
  return list;
}

async function toggleSchedule(id, enabled) {
  const list = await getSchedules();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  list[idx] = normalizeSchedule(Object.assign({}, list[idx], { enabled: !!enabled }));
  await chrome.storage.local.set({ [SCHEDULE_KEY]: list });
  return list[idx];
}

async function setScheduleResult(id, patch) {
  const list = await getSchedules();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  list[idx] = normalizeSchedule(Object.assign({}, list[idx], {
    lastRunAt: Date.now(),
    lastStatus: patch.status,
    lastSummary: patch.summary || "",
  }));
  await chrome.storage.local.set({ [SCHEDULE_KEY]: list });
  return list[idx];
}

if (typeof module !== "undefined") {
  module.exports = {
    SCHEDULE_KEY, ALARM_PREFIX, MIN_INTERVAL_MIN, MIN_ALARM_DELAY_MS, FREQUENCIES, WEEKDAYS,
    normalizeSchedule, newScheduleId, alarmName, parseTime, formatTime,
    computeNextRunAt, scheduleToAlarmInfo, describeSchedule,
    getSchedules, saveSchedule, deleteSchedule, toggleSchedule, setScheduleResult,
  };
} else {
  globalThis.SchedulerModule = {
    SCHEDULE_KEY, ALARM_PREFIX, MIN_INTERVAL_MIN, MIN_ALARM_DELAY_MS, FREQUENCIES, WEEKDAYS,
    normalizeSchedule, newScheduleId, alarmName, parseTime, formatTime,
    computeNextRunAt, scheduleToAlarmInfo, describeSchedule,
    getSchedules, saveSchedule, deleteSchedule, toggleSchedule, setScheduleResult,
  };
}
