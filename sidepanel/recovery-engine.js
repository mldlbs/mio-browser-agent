// RecoveryEngine - 恢复引擎
// 根据错误码选择恢复策略，执行恢复动作，返回统一的 RecoveryResult

const recoveryResultMod = typeof module !== "undefined"
  ? require("./recovery-result.js")
  : globalThis.RecoveryResultModule;
const recoveryPolicyMod = typeof module !== "undefined"
  ? require("./recovery-policy.js")
  : globalThis.RecoveryPolicyModule;
const _createRecoveryResult = recoveryResultMod.createRecoveryResult;
const _getAllowedActions = recoveryPolicyMod.getAllowedActions;
const _getMaxAttemptsForAction = recoveryPolicyMod.getMaxAttemptsForAction;

function runRecovery(context) {
  // context: RecoveryContext
  // 返回: Promise<RecoveryResult>
  const errorCode = context.lastError?.code || "ELEMENT_NOT_FOUND";
  const attempt = context.recoveryAttempt;
  const maxAttempts = context.maxRecoveryAttempts;
  const history = context.recoveryHistory || [];

  // 获取允许的恢复动作
  const policy = context.policy || recoveryPolicyMod.DEFAULT_RECOVERY_POLICY;
  const allowed = _getAllowedActions(context.lastError?.code || "ELEMENT_NOT_FOUND", policy);

  if (allowed.length === 0) {
    return Promise.resolve(_createRecoveryResult("finish", false, "finish", { reason: "no_allowed_actions" }));
  }

  // 检查是否超过最大尝试次数
  if (attempt >= maxAttempts) {
    return Promise.resolve(_createRecoveryResult("finish", false, "finish", { reason: "max_attempts_exceeded" }));
  }

  // 按每动作 maxAttempts 过滤：已用满的恢复动作不再参与
  const candidates = allowed.filter((a) => {
    const used = history.filter((h) => h === a.action).length;
    const perActionMax = _getMaxAttemptsForAction(errorCode, a.action, policy);
    return used < perActionMax;
  });

  if (candidates.length === 0) {
    return Promise.resolve(_createRecoveryResult("finish", false, "finish", { reason: "all_actions_exhausted" }));
  }

  // 避免连续相同动作；若最高优先级与上次相同则选下一个未用满的动作
  const lastAction = history[history.length - 1];
  const pick = candidates.find((c) => c.action !== lastAction) || candidates[0];

  return Promise.resolve(_createRecoveryResult("retry", true, "act", { action: pick.action }));
}

if (typeof module !== "undefined") {
  module.exports = { runRecovery };
} else {
  globalThis.RecoveryEngineModule = { runRecovery };
}