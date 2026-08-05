// Step orchestrator with Recovery Engine and TurnHandler
const recoveryEngineMod = typeof module !== "undefined"
  ? require("./recovery-engine.js")
  : globalThis.RecoveryEngineModule;
const metricsMod = typeof module !== "undefined"
  ? require("./metrics.js")
  : globalThis.MetricsModule;
const turnHandlerMod = typeof module !== "undefined"
  ? require("./turn-handler.js")
  : globalThis.TurnHandlerModule;
const _runRecovery = recoveryEngineMod.runRecovery;
const _startTrace = metricsMod.startTrace;
const _endTrace = metricsMod.endTrace;
const _recordReplan = metricsMod.recordReplan;
const _ActTurnHandler = turnHandlerMod.ActTurnHandler;
const _RecoveryTurnHandler = turnHandlerMod.RecoveryTurnHandler;
const _snapshotStats = typeof module !== "undefined" ? require("../common/protocol.js").snapshotStats : globalThis.snapshotStats;
const visionMod = typeof module !== "undefined"
  ? require("./vision.js")
  : globalThis.VisionModule;
const _runVisionFallback = visionMod ? visionMod.runVisionFallback : null;

// AGENT_PROMPT and buildSystemPrompt
const AGENT_PROMPT = `You are a web automation agent operating in the user's Chrome browser.
Goal: {goal}
Plan:
{plan}
Current step: {step}

You receive the page as a numbered list of interactive elements:
[0] link "首页"
[1] textbox "搜索"
[2] button "登录"

Use tools to manipulate the page. Rules:
- You are executing ONLY the Current step shown above. Do not start later steps on your own.
- Reference elements by their snapshot index.
- A fresh snapshot is provided after every action; inspect it before the next action.
- If an element is missing, wait or scroll; never assume it exists.
- When the current step is complete, call finish with a one-line summary of what you did.
- If the current step's goal is already achieved (e.g. the information was found in a previous step), call finish immediately; do not loop.
- Never claim success you cannot verify.
- Links show their destination after '→'. On shopping/search pages prefer product-card links (e.g. href containing /item/, /dp/, /product/) over shop or category links (e.g. /store/, /shop/, /seller/). Avoid clicking a shop link when you want a product.
- To find another product later, first finish the current step; the system advances you to the next step.
- If the page has not changed after a click or navigate (same URL), try again or report the problem instead of fabricating new URLs.
- You can work across multiple tabs. The snapshot header shows your active tab (Tab i/n) and all open tabs. Use the tab tool: mode=list to see all tabs, mode=open to create a new tab at a URL, mode=switch to focus another tab, mode=close to remove one.
- After switching or opening a tab, a fresh snapshot of the new active tab is provided on the next turn. Copy text from one tab and type it into another when a task spans pages (e.g. copy a code from an email tab into a login form tab).`;

function buildSystemPrompt(goal, plan, step) {
  return AGENT_PROMPT
    .replace("{goal}", goal)
    .replace("{plan}", plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n"))
    .replace("{step}", step.description);
}

async function executeStep(step, ctx) {
  const { 
    llm, bridge, memory, onLog, getTool, getToolsSchema, 
    isStopped, maxTurns, maxRecoveryAttempts = 2 
  } = ctx;
  
  // Turn handlers
  const actHandler = new _ActTurnHandler();
  const recoveryHandler = new _RecoveryTurnHandler();
  
  ctx.history[0] = { role: "system", content: buildSystemPrompt(ctx.goal, ctx.plan, step) };
  
  // Turn-based execution
  for (let turn = 0; turn < maxTurns; turn++) {
    if (isStopped && isStopped()) return { ok: false, error: "stopped by user" };
    
    // Trim history
    if (ctx.history.length > 40) {
      trimHistory(ctx.history, 40);
    }
    
    // Get fresh snapshot
    const snapshot = await safeSnapshot(bridge);
    ctx.lastSnapshot = snapshot;
    const diff = ctx.memory.remember(snapshot);
    ctx.history.push({ 
      role: "user", 
      content: snapshotToLines(snapshot) + changeNote(ctx.memory.diff || diff) 
    });
    onLog("debug", _snapshotStats(snapshot));
    
    // Generate LLM prompt for Act turn
    const systemPrompt = buildSystemPrompt(ctx.goal, ctx.plan, step);
    const messages = [
      { role: "system", content: systemPrompt },
      ...ctx.history.slice(1) // skip system message
    ];
    
    // Get tools schema (pure browser actions) + synthetic finish affordance
    const toolsSchema = getToolsSchema().concat([{
      type: "function",
      function: {
        name: "finish",
        description: "Report that the current step is complete with a one-line summary.",
        parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
      },
    }]);
    
    // Call LLM for Act turn
    const resp = await llm.generate(messages, { tools: toolsSchema });
    const asstMsg = { role: "assistant", content: resp.content || "" };
    const toolCalls = resp.toolCalls || [];
    
    if (toolCalls.length) {
      asstMsg.tool_calls = toolCalls.map((t) => ({
        id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) },
      }));
    }
    ctx.history.push(asstMsg);
    
    // Handle tool calls
    if (!toolCalls.length) {
      // Silent round - trigger recovery
      onLog("llm", "返回文本，继续观察: " + (resp.content || "").slice(0, 120));
      // If the agent keeps narrating completion without acting, end the step
      const text = (resp.content || "").toLowerCase();
      const looksDone = /complete|completed|done|finish|finished|already|successfully|added|成功|完成|已/.test(text);
      ctx.silentDoneRounds = (ctx.silentDoneRounds || 0) + (looksDone ? 1 : 0);
      if (ctx.silentDoneRounds >= 2) {
        ctx.silentDoneRounds = 0;
        onLog("finish", "静默轮次重复声明完成，自动结束当前步骤: " + (resp.content || "").slice(0, 120));
        return { ok: true, summary: (resp.content || "").slice(0, 300) };
      }
      const recoveryResult = await handleRecovery(ctx, "NO_TOOL_CALLS", null);
      if (!recoveryResult.ok) return recoveryResult;
      continue;
    }
    
    // Execute tool calls
    ctx.silentDoneRounds = 0;
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      
      if (tc.name === "finish") {
        const summary = tc.args.summary || "";
        onLog("finish", summary.slice(0, 300));
        // Complete remaining tool calls
        for (let j = i; j < toolCalls.length; j++) {
          ctx.history.push({ role: "tool", tool_call_id: toolCalls[j].id, content: JSON.stringify({ ok: true, value: "finished" }) });
        }
        return { ok: true, summary };
      }
      
      const tool = getTool(tc.name);
      if (!tool) {
        ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: `unknown tool ${tc.name}` }) });
        continue;
      }
      
      let result;
      try {
        result = await tool.execute(tc.args, { bridge, snapshot: ctx.lastSnapshot, memory: ctx.memory });
      } catch (e) {
        // Tool exceptions are immediate failures (not recoverable)
        result = { ok: false, error: (e && e.message) || String(e), errorCode: "TOOL_EXCEPTION" };
      }
      
      ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      onLog("tool", `${tc.name} → ${result.ok ? (result.value || "ok") : "ERR " + result.error}`);
      
      if (!result.ok) {
        // Tool exceptions fail immediately (not recoverable)
        if (result.errorCode === "TOOL_EXCEPTION") {
          for (let j = i + 1; j < toolCalls.length; j++) {
            ctx.history.push({ role: "tool", tool_call_id: toolCalls[j].id, content: JSON.stringify({ ok: false, error: "skipped after failure" }) });
          }
          return { ok: false, error: result.error, errorCode: result.errorCode };
        }
        // Other errors trigger recovery
        for (let j = i + 1; j < toolCalls.length; j++) {
          ctx.history.push({ role: "tool", tool_call_id: toolCalls[j].id, content: JSON.stringify({ ok: false, error: "skipped after failure" }) });
        }
        
        const errorInfo = { 
          code: result.errorCode || "ELEMENT_NOT_FOUND", 
          message: result.error 
        };
        
        const recoveryResult = await handleRecovery(ctx, errorInfo.code, errorInfo);
        if (!recoveryResult.ok) return recoveryResult;
        break; // Break to next turn after recovery
      }
    }
  }
  
  return { ok: false, error: `step exceeded ${maxTurns} turns without finish` };
}

async function handleRecovery(ctx, errorCode, errorDetails) {
  // Build recovery context
  const recoveryContext = {
    task: ctx.goal,
    stepId: ctx.currentStepId,
    recoveryAttempt: (ctx.recoveryAttempts || 0) + 1,
    maxRecoveryAttempts: (ctx.maxRecoveryAttempts || 2) + (ctx.enableVision ? 3 : 0),
    lastAction: ctx.lastAction,
    lastError: { code: errorCode, message: errorDetails?.message || errorCode },
    recoveryHistory: ctx.recoveryHistory || [],
    pageSummary: ctx.lastSnapshot ? {
      elementCount: ctx.lastSnapshot.elements?.length || 0,
      url: ctx.lastSnapshot.url,
      title: ctx.lastSnapshot.title
    } : { elementCount: 0, url: "", title: "" },
    capabilities: { vision: !!ctx.enableVision, planner: false, ocr: false }
  };
  if (ctx.enableVision) {
    const policyMod = typeof module !== "undefined" ? require("./recovery-policy.js") : globalThis.RecoveryPolicyModule;
    if (policyMod && policyMod.withVisionFallback) recoveryContext.policy = policyMod.withVisionFallback();
  }

  const emit = (ev) => ctx.onRecovery && ctx.onRecovery(ev);
  emit({ kind: "error", stepId: ctx.currentStepId, code: errorCode, message: errorDetails?.message || errorCode });

  // Run recovery engine
  const recoveryResult = await _runRecovery(recoveryContext);

  // Recovery finished - report failure for this step
  if (recoveryResult.status === "finish") {
    emit({ kind: "outcome", outcome: "exhausted" });
    return { ok: false, error: "Recovery exhausted", errorCode: "RECOVERY_EXHAUSTED" };
  }

  // Retry action
  const action = recoveryResult.detail?.action;

  // Execute recovery action
  const attempt = (ctx.recoveryAttempts || 0) + 1;
  const okFor = { ok: true };
  const notOk = (msg) => ({ ok: false, error: msg, errorCode: "RECOVERY_EXHAUSTED" });

  switch (action) {
    case "retry_snapshot":
      // Just continue to next turn (will fetch new snapshot)
      ctx.recoveryAttempts = attempt;
      ctx.recoveryHistory = ctx.recoveryHistory || [];
      ctx.recoveryHistory.push("retry_snapshot");
      emit({ kind: "attempt", action, reason: recoveryResult.detail?.reason || "重新获取页面快照", ok: true, attempt });
      return okFor;

    case "scroll_and_retry":
      // Scroll then retry
      await scrollPage(ctx.bridge, 0.8);
      ctx.recoveryAttempts = attempt;
      ctx.recoveryHistory = ctx.recoveryHistory || [];
      ctx.recoveryHistory.push("scroll_and_retry");
      emit({ kind: "attempt", action, reason: recoveryResult.detail?.reason || "滚动页面后重试", ok: true, attempt });
      return okFor;

    case "finish":
      emit({ kind: "outcome", outcome: "exhausted" });
      return notOk("Recovery exhausted");

    case "wait_and_retry":
      await sleep(1000);
      ctx.recoveryAttempts = attempt;
      ctx.recoveryHistory = ctx.recoveryHistory || [];
      ctx.recoveryHistory.push("wait_and_retry");
      emit({ kind: "attempt", action, reason: recoveryResult.detail?.reason || "等待后重试", ok: true, attempt });
      return okFor;

    case "vision_locate":
      // Last-resort fallback: ask a vision model what it sees when DOM retries keep failing.
      if (!ctx.enableVision || !_runVisionFallback) {
        emit({ kind: "outcome", outcome: "exhausted" });
        return notOk("Vision fallback disabled");
      }
      {
        const targetDesc = errorDetails?.message || `目标元素 ${ctx.lastSnapshot ? `(页面: ${ctx.lastSnapshot.url})` : ""}`;
        emit({ kind: "attempt", action, reason: "DOM 重试均失败，尝试视觉识别", ok: true, attempt });
        const v = await _runVisionFallback({
          bridge: ctx.bridge,
          llm: ctx.visionLlm || ctx.llm,
          targetDesc: targetDesc.slice(0, 120),
        });
        if (!v.ok) {
          emit({ kind: "attempt", action, reason: "视觉不可用: " + v.reason, ok: false, attempt });
          emit({ kind: "outcome", outcome: "exhausted" });
          return notOk("Vision fallback failed: " + v.reason);
        }
        ctx.recoveryHistory = ctx.recoveryHistory || [];
        ctx.recoveryHistory.push("vision_locate");
        ctx.lastVisionHint = v;
        if (!v.visible) {
          emit({ kind: "attempt", action, reason: "视觉确认目标不可见: " + v.reason, ok: false, attempt });
          emit({ kind: "outcome", outcome: "exhausted" });
          return notOk("Vision confirms target not visible: " + v.reason);
        }
        // Visible but DOM missed it: retry the snapshot once more after a beat.
        await sleep(600);
        emit({ kind: "attempt", action, reason: "视觉确认可见，重试快照: " + v.reason, ok: true, attempt });
        return okFor;
      }

    default:
      emit({ kind: "outcome", outcome: "exhausted" });
      return notOk(`Unknown recovery action: ${action}`);
  }
}

async function scrollPage(bridge, ratio = 0.8, viewportHeight) {
  try {
    const vh = viewportHeight || (typeof window !== "undefined" ? window.innerHeight : 1000);
    const delta = Math.min(Math.round(vh * ratio), 800); // min(ratio*viewport, 800px)
    await bridge.executeAction({
      name: "scroll",
      target: null,
      args: { delta }
    });
    return delta;
  } catch (e) {
    // Ignore scroll errors
    return null;
  }
}

async function safeSnapshot(bridge) {
  try {
    return await bridge.snapshot();
  } catch (_) {
    await sleep(800);
    return await bridge.snapshot();
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function trimHistory(history, maxLen) {
  if (history.length <= maxLen) return;
  let i = 1;
  while (i < history.length && history.length - i >= maxLen) {
    const msg = history[i];
    i++;
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length) {
      while (i < history.length && history[i].role === "tool") i++;
    }
  }
  history.splice(1, i - 1);
}

function changeNote(diff) {
  if (!diff.added.length && !diff.removed.length) return "";
  return `\nChanged: added ${diff.added.join(", ") || "(none)"}; removed ${diff.removed.join(", ") || "(none)"}`;
}

async function execute(plan, ctx) {
  // Initialize trace
  const traceId = _startTrace(plan.goal);
  ctx.traceId = traceId;
  
  const history = [{ role: "system", content: "" }];
  const runCtx = Object.assign({}, ctx, { history, plan, goal: plan.goal });
  let current = ctx.startStep || 0;
  let attemptsForStep = 0;
  let replans = 0;
  let lastSummary = "";
  let totalSteps = 0;
  
  runCtx.recoveryHistory = [];
  runCtx.recoveryAttempts = 0;

  const buildResume = () => ({ goal: plan.goal, plan, nextStepIndex: current, lastSummary });
  const emitCheckpoint = () => { if (ctx.onCheckpoint) ctx.onCheckpoint(buildResume()); };

  const emitProgress = (status, extra = {}) => {
    if (!ctx.onProgress) return;
    ctx.onProgress(Object.assign({
      steps: plan.steps.map((s) => s.description),
      currentIndex: current,
      status, // "running" | "done" | "failed" | "replanned"
      description: plan.steps[current] ? plan.steps[current].description : "",
    }, extra));
  };
  
  while (current < plan.steps.length) {
    if (ctx.isStopped && ctx.isStopped()) return { ok: false, error: "stopped by user", resume: buildResume() };
    totalSteps++;
    if (totalSteps > (ctx.maxSteps || 30)) {
      ctx.onLog("warn", `总步数超限 (${ctx.maxSteps || 30})，停止`);
      return { ok: false, error: `exceeded ${ctx.maxSteps || 30} total steps`, resume: buildResume() };
    }
    
    const step = plan.steps[current];
    runCtx.currentStepId = step.id || current;
    runCtx.currentStep = step;
    
    ctx.onLog("step", `[${current + 1}/${plan.steps.length}] ${step.description}`);
    emitProgress("running");
    const result = await executeStep(step, runCtx);
    
    if (result.ok) {
      const doneIndex = current;
      current++;
      attemptsForStep = 0;
      runCtx.recoveryAttempts = 0;
      runCtx.recoveryHistory = [];
      if (result.summary) lastSummary = result.summary;
      ctx.onLog("step", "DONE: " + (result.summary || "完成"));
      emitProgress("done", { summary: result.summary || "", currentIndex: doneIndex });
      emitCheckpoint();
      continue;
    }
    
    emitProgress("failed", { error: result.error || "" });
    attemptsForStep++;
    if (attemptsForStep >= (ctx.maxStepRetries || 3)) {
      replans++;
      _recordReplan();
      if (replans >= (ctx.maxReplans || 3)) {
        ctx.onLog("warn", `重规划次数超限 (${replans})，停止`);
        return { ok: false, error: `exceeded ${replans} replans`, resume: buildResume() };
      }
      ctx.onLog("warn", `步骤连续失败，重新规划: ${step.description}`);
      const newPlan = await ctx.replan(plan.goal, step);
      ctx.onLog("plan", "新计划: " + newPlan.steps.map((s, i) => `${i + 1}. ${s.description}`).join(" | "));
      plan = newPlan;
      runCtx.plan = newPlan;
      current = 0;
      attemptsForStep = 0;
      runCtx.recoveryAttempts = 0;
      runCtx.recoveryHistory = [];
      emitProgress("replanned");
    }
  }
  
  const trace = _endTrace();
  ctx.onLog("trace", `Task completed: ${trace.traceId}, recoveries: ${trace.recoveryCount}, replans: ${trace.replanCount}`);
  
  return { ok: true, summary: lastSummary || "所有步骤完成" };
}

const executor = { execute, executeStep, buildSystemPrompt, trimHistory, changeNote };
if (typeof module !== "undefined") {
  module.exports = executor;
} else {
  globalThis.executor = executor;
}