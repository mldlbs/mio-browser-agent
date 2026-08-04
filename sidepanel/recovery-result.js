// RecoveryResult - 统一恢复结果
// Runtime 只处理这个统一接口，不直接判断 action 名称

function createRecoveryResult(status, observationChanged, nextTurn, detail = {}) {
  // status: "retry" | "finish"
  // observationChanged: boolean - 页面是否发生变化
  // nextTurn: "act" | "finish"
  return {
    status,
    observationChanged: !!observationChanged,
    nextTurn,
    detail
  };
}

function createRecoveryResultFromAction(action, observationChanged = true) {
  if (action === "finish") {
    return {
      status: "finish",
      observationChanged: true,
      nextTurn: "finish",
      action: "finish"
    };
  }
  // retry_snapshot, scroll_and_retry 等都返回 retry
  return {
    status: "retry",
    observationChanged: true,
    nextTurn: "act",
    action: action || "retry_snapshot"
  };
}

if (typeof module !== "undefined") {
  module.exports = { createRecoveryResult, createRecoveryResultFromAction };
} else {
  globalThis.RecoveryResultModule = { createRecoveryResult, createRecoveryResultFromAction };
}