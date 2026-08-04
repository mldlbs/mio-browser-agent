// TurnHandler - 统一 Turn 处理框架
// 支持 Act Turn / Recovery Turn / Planning Turn 等扩展

class TurnHandler {
  constructor(name) {
    this.name = name;
  }

  // 生命周期：Turn 进入时
  onEnter(ctx) {
    // 可选：记录日志、增加计数、生成上下文
  }

  // 生命周期：Turn 退出时
  onExit(ctx) {
    // 可选：记录日志、更新统计
  }

  // 构建给 LLM 的 prompt
  buildPrompt(ctx) {
    throw new Error("buildPrompt must be implemented");
  }

  // 返回该 Turn 的 response schema（用于结构化输出）
  responseSchema() {
    throw new Error("responseSchema must be implemented");
  }

  // 处理 LLM 返回的 response
  handleResponse(resp, ctx) {
    throw new Error("handleResponse must be implemented");
  }
}

// Act Turn Handler - 正常执行轮
class ActTurnHandler extends TurnHandler {
  constructor() {
    super("act");
  }

  onEnter(ctx) {
    // 重置 silent rounds 等
    ctx.silentRounds = 0;
  }

  buildPrompt(ctx) {
    // 由 executor.js 的 buildSystemPrompt + snapshot 生成
    return ctx.prompt;
  }

  responseSchema() {
    return {
      type: "object",
      properties: {
        toolCalls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              args: { type: "object" }
            },
            required: ["name", "args"]
          }
        }
      }
    };
  }

  handleResponse(resp, ctx) {
    // 解析 toolCalls
    if (resp.toolCalls && resp.toolCalls.length > 0) {
      return { type: "tool_calls", toolCalls: resp.toolCalls };
    }
    // 无 tool calls - 视为 silent round
    return { type: "silent" };
  }
}

// Recovery Turn Handler - 恢复轮
class RecoveryTurnHandler extends TurnHandler {
  constructor(recoveryEngine) {
    super("recovery");
    this.recoveryEngine = recoveryEngine;
  }

  onEnter(ctx) {
    // 记录 recovery attempt
    ctx.recoveryAttempt = (ctx.recoveryAttempt || 0) + 1;
    // 生成 RecoveryContext
    ctx.recoveryContext = {
      task: ctx.task,
      stepId: ctx.currentStep?.id,
      recoveryAttempt: ctx.recoveryAttempt,
      maxRecoveryAttempts: ctx.maxRecoveryAttempts,
      lastAction: ctx.lastAction,
      lastError: ctx.lastError,
      recoveryHistory: ctx.recoveryHistory || [],
      pageSummary: ctx.lastSnapshot ? {
        elementCount: ctx.lastSnapshot.elements?.length || 0,
        url: ctx.lastSnapshot.url,
        title: ctx.lastSnapshot.title
      } : { elementCount: 0, url: "", title: "" },
      capabilities: { vision: false, planner: false, ocr: false }
    };
  }

  buildPrompt(ctx) {
    // 构建 recovery prompt
    const error = ctx.lastError || { code: "UNKNOWN", message: "Unknown error" };
    const allowedActions = ctx.allowedActions || ["retry_snapshot", "scroll_and_retry", "finish"];
    const lastRecovery = ctx.recoveryHistory[ctx.recoveryHistory.length - 1];
    
    let prompt = `Recovery needed.\n`;
    prompt += `Error: ${error.code} - ${error.message}\n`;
    prompt += `Attempt: ${ctx.recoveryAttempt}/${ctx.maxRecoveryAttempts}\n`;
    prompt += `Available actions: ${allowedActions.join(", ")}\n`;
    if (lastRecovery) {
      prompt += `Last recovery: ${lastRecovery} (cannot repeat same)\n`;
    }
    prompt += `\nReturn JSON:\n`;
    prompt += `{\n  "kind": "runtime",\n  "payload": {\n    "type": "recovery",\n    "action": "<one of available actions>",\n    "reason": "<why this action>"\n  }\n}`;
    return prompt;
  }

  responseSchema() {
    return {
      type: "object",
      properties: {
        kind: { const: "runtime" },
        payload: {
          type: "object",
          properties: {
            type: { const: "recovery" },
            action: { type: "string", enum: ["retry_snapshot", "scroll_and_retry", "finish"] },
            reason: { type: "string" }
          },
          required: ["type", "action", "reason"]
        }
      },
      required: ["kind", "payload"]
    };
  }

  handleResponse(resp, ctx) {
    const payload = resp.payload;
    if (!payload || payload.type !== "recovery") {
      return { type: "invalid" };
    }
    const { action, reason } = payload.payload;
    const allowed = ctx.allowedActions || ["retry_snapshot", "scroll_and_retry", "finish"];
    if (!allowed.includes(action)) {
      return { type: "invalid_action", allowed };
    }
    // 检查连续相同
    const last = ctx.recoveryHistory[ctx.recoveryHistory.length - 1];
    if (last === action) {
      return { type: "duplicate_action", allowed };
    }
    return { type: "recovery", action, reason };
  }

  onExit(ctx) {
    // 记录 recovery action 到历史
    ctx.recoveryHistory = ctx.recoveryHistory || [];
    if (ctx.lastRecoveryAction) {
      ctx.recoveryHistory.push(ctx.lastRecoveryAction);
    }
  }
}

if (typeof module !== "undefined") {
  module.exports = { TurnHandler, ActTurnHandler, RecoveryTurnHandler };
} else {
  globalThis.TurnHandlerModule = { TurnHandler, ActTurnHandler, RecoveryTurnHandler };
}