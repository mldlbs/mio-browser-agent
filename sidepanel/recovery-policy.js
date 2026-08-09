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
  ],
  CLICK_AT_UNVERIFIED: [
    { action: "retry_snapshot", priority: 90, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  CLICK_OUT_OF_VIEWPORT: [
    { action: "retry_snapshot", priority: 90, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  SEND_NOT_VERIFIED: [
    { action: "wait_and_retry", priority: 90, maxAttempts: 2 },
    { action: "retry_snapshot", priority: 80, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  // Already at a scroll boundary: further scroll can never reach the target, so
  // the only DOM-side option is a fresh snapshot (target may have re-rendered).
  // vision_locate is appended when the vision fallback is enabled so a target
  // that IS visible but outside the DOM locator can still be reached by pixels.
  SCROLL_AT_END: [
    { action: "retry_snapshot", priority: 90, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  // A control is disabled (often a transient React/editor sync state right after
  // another interaction). Wait for the state to settle, then retry; do not
  // immediately give up and do not spam clicks on the same disabled element.
  ELEMENT_DISABLED: [
    { action: "wait_and_retry", priority: 100, maxAttempts: 2 },
    { action: "retry_snapshot", priority: 70, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  FIELD_NOT_FOUND: [
    { action: "retry_snapshot", priority: 90, maxAttempts: 1 },
    { action: "finish", priority: 10, maxAttempts: 1 }
  ],
  SUBMIT_NOT_FOUND: [
    { action: "retry_snapshot", priority: 90, maxAttempts: 1 },
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

// Return a policy that injects vision_locate as a last resort: after DOM-retry
// actions are exhausted but before giving up entirely (priority between DOM
// actions and finish). Only used when the vision fallback is enabled.
function withVisionFallback(policy = DEFAULT_RECOVERY_POLICY) {
  const out = {};
  for (const [code, actions] of Object.entries(policy)) {
    if (!actions.some((a) => a.action === "vision_locate")) {
      out[code] = [...actions, { action: "vision_locate", priority: 15, maxAttempts: 1 }];
    } else {
      out[code] = actions;
    }
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { DEFAULT_RECOVERY_POLICY, getAllowedActions, getMaxAttemptsForAction, withVisionFallback };
} else {
  globalThis.RecoveryPolicyModule = { DEFAULT_RECOVERY_POLICY, getAllowedActions, getMaxAttemptsForAction, withVisionFallback };
}