// 失败分析（Failure Stats）— 从历史任务的 stepEvents 聚合失败错误码频率，
// 定位高频失败场景（top N）。纯函数，可单测。数据源：HistoryModule 记录的
// stepEvents（已持久化在 chrome.storage.local，含 type:"recovery" 事件）。

// 提取一条历史记录里的失败错误码集合（去重，一条记录算一次）。
// record: normalizeRecord 后的历史项（含 stepEvents）。
function extractErrorCodes(record) {
  const events = (record && record.stepEvents) || [];
  const codes = new Set();
  for (const ev of events) {
    if (ev.type === "recovery" && ev.kind === "error" && ev.code) codes.add(ev.code);
    else if (ev.type === "tool_failed" && ev.errorCode) codes.add(ev.errorCode);
    else if (ev.type === "step_failed" && ev.errorCode) codes.add(ev.errorCode);
  }
  return [...codes];
}

// 聚合多天记录：{ errorCode: count }，按次数降序。
function aggregateErrors(records) {
  const counts = {};
  for (const r of records || []) {
    for (const code of extractErrorCodes(r)) {
      counts[code] = (counts[code] || 0) + 1;
    }
  }
  return counts;
}

// 返回降序排序的 [ {code, count} ] 数组，取 top n（默认 3）。
function topErrors(records, n) {
  const counts = aggregateErrors(records);
  return Object.keys(counts)
    .map((code) => ({ code, count: counts[code] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n || 3);
}

// 一次任务的"是否失败"判断：status 为 error / 含 RECOVERY_EXHAUSTED 事件 / 有 failed 步骤。
function isFailed(record) {
  if (!record) return false;
  if (record.status === "error") return true;
  const events = record.stepEvents || [];
  return events.some((ev) =>
    (ev.type === "recovery" && ev.kind === "outcome" && ev.outcome === "exhausted") ||
    (ev.type === "step_failed")
  );
}

// 简单成功率统计：{ total, failed, successRate }。
function successRate(records) {
  const list = records || [];
  const total = list.length;
  const failed = list.filter(isFailed).length;
  return { total, failed, successRate: total ? (total - failed) / total : 0 };
}

if (typeof module !== "undefined") {
  module.exports = { extractErrorCodes, aggregateErrors, topErrors, isFailed, successRate };
} else {
  globalThis.FailureStatsModule = { extractErrorCodes, aggregateErrors, topErrors, isFailed, successRate };
}
