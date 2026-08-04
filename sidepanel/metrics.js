// Metrics - TraceID 生成与指标收集
// 每个 Task 一个 TraceID，串联 Recovery/Replan/Finish

let currentTraceId = null;
const metrics = {
  recoveryCount: 0,
  recoverySuccessCount: 0,
  finishFailedCount: 0,
  replanCount: 0,
  totalRecoveryAttempts: 0,
  traceId: null
};

function generateTraceId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function startTrace(taskName) {
  currentTraceId = generateTraceId();
  metrics.traceId = currentTraceId;
  metrics.taskName = taskName;
  metrics.recoveryCount = 0;
  metrics.recoverySuccessCount = 0;
  metrics.finishFailedCount = 0;
  metrics.replanCount = 0;
  metrics.totalRecoveryAttempts = 0;
  metrics.startTime = Date.now();
  return currentTraceId;
}

function endTrace() {
  const duration = Date.now() - (metrics.startTime || 0);
  const summary = {
    traceId: currentTraceId,
    taskName: metrics.taskName,
    duration,
    recoveryCount: metrics.recoveryCount,
    recoverySuccessRate: metrics.recoveryCount > 0 ? metrics.recoverySuccessCount / metrics.recoveryCount : 0,
    averageRecoveryAttempts: metrics.recoveryCount > 0 ? metrics.totalRecoveryAttempts / metrics.recoveryCount : 0,
    finishFailedCount: metrics.finishFailedCount,
    replanCount: metrics.replanCount
  };
  currentTraceId = null;
  return summary;
}

function recordRecovery(success) {
  metrics.recoveryCount++;
  metrics.totalRecoveryAttempts++;
  if (success) metrics.recoverySuccessCount++;
}

function recordFinishFailed() {
  metrics.finishFailedCount++;
}

function recordReplan() {
  metrics.replanCount++;
}

function getCurrentTraceId() {
  return currentTraceId;
}

function getMetrics() {
  return { ...metrics };
}

function resetMetrics() {
  currentTraceId = null;
  metrics.recoveryCount = 0;
  metrics.recoverySuccessCount = 0;
  metrics.finishFailedCount = 0;
  metrics.replanCount = 0;
  metrics.totalRecoveryAttempts = 0;
  metrics.traceId = null;
}

if (typeof module !== "undefined") {
  module.exports = {
    startTrace,
    endTrace,
    recordRecovery,
    recordFinishFailed,
    recordReplan,
    getCurrentTraceId,
    getMetrics,
    resetMetrics
  };
} else {
  globalThis.MetricsModule = {
    startTrace,
    endTrace,
    recordRecovery,
    recordFinishFailed,
    recordReplan,
    getCurrentTraceId,
    getMetrics,
    resetMetrics
  };
}