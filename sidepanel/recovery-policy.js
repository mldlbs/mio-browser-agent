// RecoveryPolicy - 表驱动恢复策略
// 完全配置化，无硬编码 if(error.code)

const DEFAULT_RECOVERY_POLICY = {
  ELEMENT_NOT_FOUND: [
    { action: "retry_snapshot", priority: 100, maxAttempts: 2 },
    { action: "scroll_and_retry", priority: 80, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  STALE_ELEMENT: [
    { action: "retry_snapshot", priority: 100, maxAttempts: 2 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  TIMEOUT: [
    { action: "wait_and_retry", priority: 100, maxAttempts: 2 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  NO_TOOL_CALLS: [
    { action: "retry_snapshot", priority: 90, maxAttempts: 1 },
    { action: "scroll_and_retry", priority: 70, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ]
};

function getAllowedActions(errorCode, policy = DEFAULT_RECOVERY_POLICY) {
  const actions = policy[errorCode];
  if (!actions) return [];
  // 按 priority 降序排序
  return [...actions].sort((a, b) => b.priority - a.priority);
}

function getMaxAttemptsForAction(errorCode, action, policy = DEFAULT_RECOVERY_POLICY) {
  const actions = policy[errorCode];
  if (!actions) return 0;
  const found = actions.find(a => a.action === action);
  return found ? found.maxAttempts : 0;
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULT_RECOVERY_POLICY, getAllowedActions, getMaxAttemptsForAction };
} else {
  globalThis.RecoveryPolicyModule = { DEFAULT_RECOVERY_POLICY, getAllowedActions, getMaxAttemptsForAction };
}