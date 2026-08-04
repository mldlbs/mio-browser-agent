// RecoveryContext - 统一恢复上下文
// 供 RecoveryEngine 使用，包含恢复决策所需的所有信息

function createRecoveryContext(task, stepId, recoveryAttempt, maxRecoveryAttempts, lastAction, lastError, recoveryHistory, pageSummary, capabilities = {}) {
  return {
    task,
    stepId,
    recoveryAttempt,
    maxRecoveryAttempts,
    lastAction: lastAction || null,
    lastError: lastError || null,
    recoveryHistory: recoveryHistory || [],
    pageSummary: pageSummary || { elementCount: 0, url: "", title: "" },
    capabilities: {
      vision: !!capabilities.vision,
      planner: !!capabilities.planner,
      ocr: !!capabilities.ocr
    },
    timestamp: Date.now()
  };
}

if (typeof module !== "undefined") {
  module.exports = { createRecoveryContext };
} else {
  globalThis.RecoveryContextModule = { createRecoveryContext };
}