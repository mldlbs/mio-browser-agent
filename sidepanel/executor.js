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
const _runSendConfirm = visionMod ? visionMod.runSendConfirm : null;

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
- finish marks the CURRENT step complete; the system then advances you to the next step. It does not end the whole task.
- If the current step is purely informational and the needed information is already in the conversation, you may call finish immediately. But if the step requires an action (typing, clicking, sending, extracting), execute that action with tools FIRST — never declare a step complete without doing its required action.
- Steps are tracked one by one: finish completes ONLY the current step and the system advances you to the next one. Never perform a later step's actions (typing credentials, reading captchas, clicking submit, extracting) while on the current step — the progress panel records each step as you finish it.
- For opening/confirmation steps (e.g. "open URL and confirm the page shows X"): as soon as the page is open and matches the description, call finish immediately. Do not start typing, reading captchas, or clicking even if the form looks ready.
- Never claim success you cannot verify.
- Links show their destination after '→'. On shopping/search pages prefer product-card links (e.g. href containing /item/, /dp/, /product/) over shop or category links (e.g. /store/, /shop/, /seller/). Avoid clicking a shop link when you want a product.
- To find another product later, first finish the current step; the system advances you to the next step.
- If the page has not changed after a click or navigate (same URL), try again or report the problem instead of fabricating new URLs.
- After clicking a submit/send button, WAIT for the page to respond (new message, loading indicator, navigation) before doing anything else. Do NOT click the same button twice — a repeated click on a send button re-submits the same input and can double-send. If a click result is uncertain, verify via the snapshot instead of clicking again. The system automatically verifies send clicks (input cleared / new message / vision confirm); a "发送未确认" error means the send did NOT go through — retry the send, or type again and press the send control, instead of assuming it worked.
- Icon-only buttons (e.g. named "图标按钮(输入框右下)") have no visible label. When you need to submit/send, pick the icon button annotated as beside/below the textbox you just typed into (look for "输入框右下"/"输入框下"/"输入框旁") — the send control sits at the bottom-right of the chat input. Do not click random icon buttons elsewhere on the page.
- Login forms often include a verification code (验证码/captcha) drawn on a canvas or img element. To read it, call the read_captcha tool — it screenshots the page and has the vision model read the 4 characters; then type the result into the 验证码 input. read_captcha is the ONLY captcha-reading tool and needs no other screenshot tool. If a captcha looks unreadable, click the captcha image first to refresh it, then call read_captcha again. Never declare a captcha unreadable before calling read_captcha at least once.
- You can work across multiple tabs. The snapshot header shows your active tab (Tab i/n) and all open tabs. Use the tab tool: mode=list to see all tabs, mode=open to create a new tab at a URL, mode=switch to focus another tab, mode=close to remove one.
- After switching or opening a tab, a fresh snapshot of the new active tab is provided on the next turn. Copy text from one tab and type it into another when a task spans pages (e.g. copy a code from an email tab into a login form tab).
- On Reddit, never navigate to moderator-only /mod/... URLs (e.g. /mod/<sub>/rules) — those are blocked for normal users and trigger captchas. To read a subreddit's rules use the public page: https://www.reddit.com/r/<sub>/about/rules/. Avoid scraping reddit.com site-wide.`;

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
  
  // Duplicate-click guard: an element just clicked with no intervening action must
  // not be clicked again. Prevents the agent from double-sending on pages whose
  // rich editors (ProseMirror/React) desync the DOM from their internal state.
  if (ctx._lastClick === undefined) ctx._lastClick = null;
  if (ctx._actionsSinceLastClick === undefined) ctx._actionsSinceLastClick = 0;
  ctx.silentDoneRounds = 0;
  
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
    const risk = detectPageRisk(snapshot);
    if (risk) {
      onLog("warn", `检测到页面风险 (${risk.reason})：停止当前步骤，避免触发风控。${risk.url}`);
      return { ok: false, error: risk.reason, errorCode: "PAGE_RISK_STOP", risk: risk.reason };
    }
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
      // Silent round - no tool call. Usually flows to recovery; but if the agent
      // keeps narrating completion without acting, end the step.
      onLog("llm", "返回文本，继续观察: " + (resp.content || "").slice(0, 120));
      const text = (resp.content || "").toLowerCase();
      const looksDone = /complete|completed|done|finish|finished|already|successfully|added|成功|完成|已/.test(text);
      ctx.silentDoneRounds = (ctx.silentDoneRounds || 0) + (looksDone ? 1 : 0);
      // First "done" narration with zero tool calls gets ONE explicit correction
      // before auto-ending: a step that needs an action (send/extract/click) must
      // not be silently skipped just because the agent believes the whole task is
      // already finished.
      if (looksDone && ctx.silentDoneRounds === 1) {
        ctx.history.push({ role: "user", content: "注意：你上一轮只写了叙述而没有调用工具，也没有调用 finish。若当前步骤确已完成，请直接调用 finish 并附一行总结；若本步骤还需动作（输入/点击/发送/提取等），请调用相应工具执行。仅叙述完成不会推进进度。" });
        onLog("recovery", "NO_TOOL_CALLS 注入纠正: 仅叙述完成无效，需调用 finish 或执行工具");
        continue;
      }
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

      // Duplicate-click guard: if the agent tries to click the exact same target
      // again with no successful action in between, short-circuit it instead of
      // letting the click land twice (common cause of double-submits).
      if (tc.name === "click") {
        const key = clickTargetKey(tc.args);
        if (key && key === ctx._lastClick) {
          ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: "duplicate click: this element was just clicked with no action in between; do not click it again — check the page instead" }) });
          onLog("tool", `click → SKIPPED duplicate (${key})`);
          continue;
        }
      }
      
      const tool = getTool(tc.name);
      if (!tool) {
        ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: `unknown tool ${tc.name}` }) });
        continue;
      }
      
      let result;
      try {
        result = await tool.execute(tc.args, { bridge, snapshot: ctx.lastSnapshot, memory: ctx.memory, llm: ctx.visionLlm || ctx.llm });
      } catch (e) {
        // Tool exceptions are immediate failures (not recoverable)
        result = { ok: false, error: (e && e.message) || String(e), errorCode: "TOOL_EXCEPTION" };
      }
      
      ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      const shown = result.value == null ? "ok" : (typeof result.value === "string" ? result.value.slice(0, 120) : JSON.stringify(result.value).slice(0, 120));
      onLog("tool", `${tc.name} → ${result.ok ? shown : "ERR " + result.error}`);

      // Human-paced pacing: state-changing actions get a random 300-900ms pause
      // before the next turn so the page settles and the timing looks natural
      // (less likely to trip bot detection on sites like Reddit).
      if (result.ok && isStateChangingTool(tc.name)) {
        await sleep(rand(300, 900));
      }
      
      // ── Send verification loop ──
      // A send click can silently no-op (disabled send button / editor-state
      // desync) while the tool still reports ok. For send-type buttons verify the
      // click actually worked: DOM signals (input cleared / url changed / new
      // elements) first, then vision confirm as the last resort. Unverified sends
      // become SEND_NOT_VERIFIED and flow through recovery.
      // Runs BEFORE the flag update below so it can read ctx._lastTyped.
      let sendVerifiedOk = null; // undefined=not a send click, true/false=result
      if (tc.name === "click" && result.ok && ctx._lastTyped && ctx.lastSnapshot && (tc.args && typeof tc.args.index === "number")) {
        const target = ctx.lastSnapshot.elements[tc.args.index];
        if (target && isSendTarget(target)) {
          const verify = await verifySend(ctx, target);
          if (!verify.ok) {
            onLog("tool", `click → 发送未确认 (${verify.how}): ${verify.reason || "DOM 无变化"}`);
            const errResult = { ok: false, error: "send not verified: " + (verify.reason || verify.how), errorCode: "SEND_NOT_VERIFIED" };
            // Replace this tool call's result in history (don't duplicate same id).
            ctx.history.pop();
            ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(errResult) });
            for (let j = i + 1; j < toolCalls.length; j++) {
              ctx.history.push({ role: "tool", tool_call_id: toolCalls[j].id, content: JSON.stringify({ ok: false, error: "skipped after send verification failed" }) });
            }
            const recoveryResult = await handleRecovery(ctx, "SEND_NOT_VERIFIED", { message: errResult.error });
            if (!recoveryResult.ok) return recoveryResult;
            break; // next turn, fresh snapshot
          }
          onLog("tool", `click → 发送已确认 (${verify.how})`);
          ctx._lastSendVerified = true;
          sendVerifiedOk = true;
        }
      }

      if (result.ok) {
        // Track the last successful click target so a duplicate click in the next
        // round is short-circuited (prevents double-submitting on chat pages).
        if (tc.name === "click" && result.ok) {
          ctx._lastClick = clickTargetKey(tc.args);
        } else if (tc.name !== "click" && isStateChangingTool(tc.name)) {
          // Only state-changing actions (type/paste/navigate/tab) break the
          // "no intervening action" chain. Passive tools (wait, extract_text,
          // scroll) do NOT clear the guard — a click-wait-click on the same
          // target is still a duplicate and must be short-circuited.
          ctx._lastClick = null;
        }
        // Remember we typed into a textbox, so the next send-button click is
        // verified (did the message actually get sent?). Both type and paste
        // feed the input, so both arm the send verification.
        if ((tc.name === "type" || tc.name === "paste") && result.ok) {
          ctx._lastTyped = true;
        } else if (tc.name === "click" && sendVerifiedOk === true) {
          // Only a VERIFIED send click consumes the "just typed" flag. A failed
          // verification (or a non-send click) keeps it so the retry is re-verified.
          ctx._lastTyped = false;
        }
      }

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

// Unique key for a click target so duplicate clicks are detected across rounds.
// Falls back to "index:" when the index is missing, or null if there is no target.
function clickTargetKey(args) {
  const idx = args && args.index;
  if (typeof idx === "number") return "index:" + idx;
  if (args && (args.selector || args.cssPath || args.xpath)) return "sel:" + (args.selector || args.cssPath || args.xpath);
  return null;
}

// Heuristic: does this snapshot element look like a send/submit control that
// should be verified after clicking? Matches send/submit/发送 named buttons and
// icon buttons annotated as being near a textbox (the chat-send control shape).
function isSendTarget(el) {
  if (!el) return false;
  const n = (el.name || "").toLowerCase();
  if (/(发送|提交|send|submit|发送消息)/.test(n)) return true;
  // Icon button annotated with its position relative to the input (输入框…).
  if (/图标/.test(el.name || "") && /输入框/.test(el.name || "") && el.role === "button") return true;
  return false;
}

// Tools that mutate page/tab state. Only these break the duplicate-click guard;
// passive tools (wait, extract_text, scroll, waitFor) leave it armed so a
// click-wait-click on the same target is still detected as a duplicate.
function isStateChangingTool(name) {
  return name === "type" || name === "paste" || name === "navigate" || name === "tab" || name === "scroll";
}

// Heuristic page-risk detection. When a target site shows a captcha challenge,
// a "removed/deleted" notice, or a rate-limit wall, continuing to act is both
// pointless and likely to worsen account/IP standing. Fail the step loudly
// instead of letting the agent spin through retries.
function detectPageRisk(snapshot) {
  if (!snapshot) return null;
  const url = snapshot.url || "";
  const title = snapshot.title || "";
  const text = [url, title].join(" ").toLowerCase();
  const riskyUrl = /recaptcha|hcaptcha|captcha|verify|challenge/.test(url);
  const captchaTitle = /captcha|验证码|human verification|verify you are human|are you a robot|确认你是真人|人机验证/i.test(title);
  if (riskyUrl || captchaTitle) {
    return { reason: "页面出现验证码/人机验证（captcha）", url: url || title };
  }
  const removedTitle = /this post was removed|this content was removed|post removed|帖子已被删除|已被删除|removed by moderator|unavailable/i.test(title);
  const removedUrl = /removed|deleted/.test(url) && /reddit|\.com/.test(url);
  if (removedTitle || removedUrl) {
    return { reason: "页面内容已被删除/不可用，继续操作无意义", url: url || title };
  }
  const rateLimit = /rate limit|slow down|try again later|too many requests|429/i.test(title);
  if (rateLimit) {
    return { reason: "触发了频率限制（rate limit）", url: url || title };
  }
  // Moderator-only tooling (/mod/...) is off-limits for normal automation and
  // a hotspot for captcha walls (e.g. /mod/<sub>/rules). Treat it as risky.
  if (/reddit\.com\/mod\//i.test(url)) {
    return { reason: "访问了版主工具页 /mod/（普通用户不可达，易触发验证码）", url: url || title };
  }
  return null;
}

// Verify that a send click actually worked. Returns { ok, how, reason }.
// 1) DOM signals: the typed textbox got cleared, url changed, or new elements
//    appeared. 2) If ambiguous, ask the vision model (runSendConfirm) whether
//    the input was cleared / a new user message appeared.
async function verifySend(ctx, target) {
  const bridge = ctx.bridge;
  try {
    // Give the page a beat to process the click (send → async request).
    await sleep(1500);
    const after = await safeSnapshot(bridge);
    const before = ctx.lastSnapshot || {};
    const beforeBox = before.elements || [];
    const afterBox = after.elements || [];

    // Signal 1: the textbox we typed into is now empty (classic send-clear).
    const typedCleared = beforeBox.some((e) => {
      if (e.role !== "textbox" && e.role !== "combobox") return false;
      if (!e.value || !e.value.trim()) return false;
      const match = afterBox.find((a) => a.role === e.role && a.name === e.name);
      return !match || !match.value || !match.value.trim();
    });
    if (typedCleared) return { ok: true, how: "输入框已清空", reason: "" };

    // Signal 2: navigation happened (form submit / page change).
    if (after.url && before.url && after.url !== before.url) {
      return { ok: true, how: "URL 已变化", reason: "" };
    }

    // Signal 3: the page gained meaningful new content (new message rows).
    const grew = afterBox.length > beforeBox.length + 2;
    if (grew) return { ok: true, how: "页面新增元素", reason: "" };

    // Ambiguous by DOM: vision is the last word when enabled.
    if (ctx.enableVision && _runSendConfirm) {
      const v = await _runSendConfirm({ bridge, llm: ctx.visionLlm || ctx.llm });
      if (v.ok) {
        if (v.sent) return { ok: true, how: "视觉确认已发送", reason: v.reason };
        return { ok: false, how: "视觉确认未发送", reason: v.reason };
      }
      return { ok: false, how: "视觉不可用", reason: v.reason };
    }

    return { ok: false, how: "DOM 无变化", reason: "点击后输入框未清空、URL 未变、无新增元素" };
  } catch (e) {
    return { ok: false, how: "验证异常", reason: (e && e.message) || String(e) };
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

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

const executor = { execute, executeStep, buildSystemPrompt, trimHistory, changeNote, detectPageRisk, isStateChangingTool };
if (typeof module !== "undefined") {
  module.exports = executor;
} else {
  globalThis.executor = executor;
}