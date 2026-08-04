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
  const allowed = _getAllowedActions(context.lastError?.code || "ELEMENT_NOT_FOUND");

  if (allowed.length === 0) {
    return Promise.resolve(_createRecoveryResult("finish", false, "finish", { reason: "no_allowed_actions" }));
  }

  // 检查是否超过最大尝试次数
  if (attempt >= context.maxRecoveryAttempts) {
    return Promise.resolve(_createRecoveryResult("finish", false, "finish", { reason: "max_attempts_exceeded" }));
  }

  // 选择优先级最高的动作（已经按 priority 降序排序）
  const candidate = allowed[0];

  // 检查连续相同动作
  if (context.recoveryHistory.length > 0) {
    const lastAction = context.recoveryHistory[context.recoveryHistory.length - 1];
    if (lastAction === candidate.action) {
      // 连续相同，尝试下一个优先级
      const nextCandidate = allowed[1];
      if (!nextCandidate) {
        return Promise.resolve(_createRecoveryResult("finish", false, "finish", { reason: "duplicate_recovery_no_alternative" }));
      }
      // 使用下一个候选
      return Promise.resolve(_createRecoveryResult("retry", true, "act", { action: nextCandidate.action, reason: "avoid_duplicate" }));
    }
  }

  // 返回选中的恢复动作
  return Promise.resolve(_createRecoveryResult("retry", true, "act", { action: candidate.action }));
}

if (typeof module !== "undefined") {
  module.exports = { runRecovery };
} else {
  globalThis.RecoveryEngineModule = { runRecovery };
}