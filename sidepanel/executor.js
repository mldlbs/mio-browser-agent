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
// Core rules always apply; step-type-specific blocks are injected by
// classifyStep so a pure "open page" step does not carry the full send/login/
// cross-page rule set (less noise per turn, better focus).
const AGENT_PROMPT = `You are a web automation agent operating in the user's Chrome browser.
Goal: {goal}
Plan:
{plan}
Current step: {step}

{stepFocus}

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
- Never claim success you cannot verify.
- Links show their destination after '→'. On shopping/search pages prefer product-card links (e.g. href containing /item/, /dp/, /product/) over shop or category links (e.g. /store/, /shop/, /seller/). Avoid clicking a shop link when you want a product.
- To find another product later, first finish the current step; the system advances you to the next step.
- If the page has not changed after a click or navigate (same URL), try again or report the problem instead of fabricating new URLs.
- If you can SEE the target on the page but it is not in the snapshot list (canvas/overlay/dynamic content the DOM locator misses), use the click_at tool with its viewport coordinates (x, y) instead of giving up or guessing a snapshot index. Prefer the normal click tool by snapshot index whenever the element IS listed.
- NEVER guess click_at coordinates blindly. Only call click_at with (x, y) values you actually know: from a vision_locate hint the system injected, or from a coordinate you can reason about precisely. If you do not know the exact pixel position, do NOT spam click_at at made-up coordinates — instead describe the target element precisely and call finish for the step, or wait for the system's vision guidance. Blind coordinate spam on the same area repeatedly is how tasks spiral into replans; a click that changes nothing on the page means the target was not hit, so stop guessing.
- On Reddit, never navigate to moderator-only /mod/... URLs (e.g. /mod/<sub>/rules) — those are blocked for normal users and trigger captchas. To read a subreddit's rules use the public page: https://www.reddit.com/r/<sub>/about/rules/. Avoid scraping reddit.com site-wide.`;

// Step-type focus blocks. Each is injected (as {stepFocus}) when the current
// step's description matches that type, keeping irrelevant rules out of the
// prompt for steps that do not need them.
const STEP_FOCUS = {
  open: `- 本步骤是打开/确认页面：页面打开且内容与描述匹配后，立即调用 finish 并附一行总结。不要开始输入、读取验证码或点击，即使表单看起来已就绪。`,
  send: `- 点击发送/提交按钮后 WAIT 让页面响应（新消息、加载指示、跳转），不要重复点击同一按钮——重复点击会重复提交。系统会自动验证发送（输入框清空/新消息/视觉确认）；「发送未确认」说明发送未成功——重试发送，或重新输入后再点发送控件，不要假定已发出。
- 图标按钮（如「图标按钮(输入框右下)」）无可见文字。提交/发送时，选你在其中输入过文字的输入框右下/下/旁的图标按钮（聊天发送键在输入框右下角）。不要点页面上其它随机图标按钮。`,
  login: `- 登录表单常含验证码（canvas/img）。用 read_captcha 工具读取——它截屏并由视觉模型读出字符，然后输入到验证码框。read_captcha 是唯一读取验证码的工具，无需其它截图工具。验证码看不清先点它刷新再重读；调用 read_captcha 至少一次前，不要判定验证码不可读。`,
  tab: `- 任务可跨多个标签页：用 tab 工具 list 查看所有页、open 新开、switch 切换、close 关闭；快照头显示当前标签页（Tab i/n）。切换/新开后下一轮会提供新标签页的完整快照。
- 跨页搬运的数据（验证码、价格、提取的 id）MUST 用 memo set 保存、memo get 读取。对话历史在长任务中会被裁剪，早前读到的值可能已不在上下文——离开页面（如邮箱验证码）前先 memo，目标页上再 memo get。不要凭记忆重打。`,
  extract: `- 本步骤需要提取页面数据：用 extract_text 提取正文，或从快照索引读取目标内容。若提取结果后续步骤还要用，先用 memo set 保存（key=value），需要时再 memo get。`,
};

// Classify a step description so buildSystemPrompt can inject only the
// relevant focus block. Order matters: more specific patterns first. Note that
// "验证码" alone is NOT login — reading a code from an email into a form is a
// cross-page task; login intent requires an account/login action.
function classifyStep(desc) {
  const d = (desc || "").toLowerCase();
  if (/(登录页|登录|账号|密码|用户名|login|sign\s*in|signin)/.test(d)) return "login";
  if (/(发送|提交|回复|发布|send|submit|post|reply)/.test(d)) return "send";
  if (/(标签页|切换|新标签|邮箱|另一个站|跨站|跨页|新窗口|tab\b)/.test(d)) return "tab";
  if (/(提取|获取|读取|抓取|总结|要点|内容|extract|summarize|collect|scrape)/.test(d)) return "extract";
  if (/(打开|确认|进入|访问|open|confirm|verify)/.test(d)) return "open";
  return "";
}

function buildSystemPrompt(goal, plan, step) {
  const focus = STEP_FOCUS[classifyStep(step.description)] || "";
  return AGENT_PROMPT
    .replace("{goal}", goal)
    .replace("{plan}", plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n"))
    .replace("{step}", step.description)
    .replace("{stepFocus}", focus);
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
  ctx._riskRounds = 0;
  ctx._stepActions = 0;
  ctx._stepStartSnapshot = null;
  ctx._stepFinishWarned = undefined;
  
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
    if (!ctx._stepStartSnapshot) ctx._stepStartSnapshot = snapshot;
    const risk = detectPageRisk(snapshot);
    if (risk) {
      // Don't hard-fail immediately: the agent may be on a leftover risky tab
      // (e.g. a moderator-only /mod/ page) that it can navigate away from.
      // Inject a hint so the LLM can switch tabs / navigate to a clean page.
      // Only give up after 3 consecutive rounds still on a risky page.
      ctx._riskRounds = (ctx._riskRounds || 0) + 1;
      if (ctx._riskRounds >= 3) {
        onLog("warn", `连续 ${ctx._riskRounds} 轮仍在风险页 (${risk.reason})：停止当前步骤。${risk.url}`);
        return { ok: false, error: risk.reason, errorCode: "PAGE_RISK_STOP", risk: risk.reason };
      }
      onLog("warn", `检测到页面风险 (${risk.reason})：提示 agent 离开当前页面。${risk.url}`);
      ctx.history.push({
        role: "user",
        content: `[系统] 当前页面检测到风险（${risk.reason}，URL: ${risk.url || "未知"}）。` +
          `请勿在此页面执行任何点击/输入。用 tab 工具切换到其他标签页，` +
          `或新建标签页导航到目标页面后再继续当前步骤。`,
      });
    } else {
      ctx._riskRounds = 0;
    }
    const diff = ctx.memory.remember(snapshot);
    ctx.history.push({ 
      role: "user", 
      content: snapshotToLines(snapshot) + changeNote(ctx.memory.diff || diff) + notesNote(ctx.notes)
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
        // Guard against "said done but did nothing": if this step clearly
        // needed an action and none was performed (and the page did not change),
        // reject the finish once and ask the agent to actually act.
        const outcome = (ctx.verifyStepOutcome && (await _verifyStepOutcome(ctx, step))) || { ok: true, reason: "" };
        if (!outcome.ok && ctx._stepFinishWarned === undefined) {
          ctx._stepFinishWarned = true;
          ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: outcome.reason, errorCode: "STEP_NOT_VERIFIED" }) });
          ctx.history.push({
            role: "user",
            content: `[系统] 本步骤 "${step.description}" 需要实际动作，但你没有执行任何操作且页面没有变化（${outcome.reason}）。` +
              `请真正执行该步骤所需的工具（输入/点击/提交/提取等），完成后再调用 finish。`,
          });
          onLog("recovery", `STEP_NOT_VERIFIED 注入纠正: ${outcome.reason}`);
          continue;
        }
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
        const key = clickTargetKey(tc.args, ctx.lastSnapshot);
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
        result = await tool.execute(tc.args, { bridge, snapshot: ctx.lastSnapshot, memory: ctx.memory, notes: ctx.notes, llm: ctx.visionLlm || ctx.llm });
      } catch (e) {
        // Tool exceptions are immediate failures (not recoverable)
        result = { ok: false, error: (e && e.message) || String(e), errorCode: "TOOL_EXCEPTION" };
      }
      
      ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      const shown = result.value == null ? "ok" : (typeof result.value === "string" ? result.value.slice(0, 120) : JSON.stringify(result.value).slice(0, 120));
      onLog("tool", `${tc.name} → ${result.ok ? shown : "ERR " + result.error}`);

      // ── Click_at spam guard ──
      // If the agent clicks the SAME coordinates again and the page did not
      // change at all, it is guessing blindly (observed: 4+ clicks at ~(100,4xx)
      // while hunting a vision-only element). Flag it so it flows into the
      // recovery chain (which can invoke vision_locate) instead of looping.
      if (tc.name === "click_at" && result.ok && ctx.lastSnapshot) {
        const key = `${Math.round(tc.args.x || 0)},${Math.round(tc.args.y || 0)}`;
        const sig = `${ctx.lastSnapshot.url || ""}|${(ctx.lastSnapshot.elements || []).length}`;
        const prev = ctx._clickAtLast;
        if (prev && prev.key === key && prev.sig === sig && ctx._clickAtSpamWarned !== key) {
          ctx._clickAtSpamWarned = key;
          result = { ok: false, error: "click_at hit the same coordinates with no page change; the target was likely not there. Do not keep guessing coordinates — describe the target and wait for vision guidance, or use a snapshot index.", errorCode: "CLICK_AT_UNVERIFIED" };
          ctx.history.pop();
          ctx.history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
          onLog("tool", `click_at → 盲试拦截 (${key} 无页面变化)`);
        } else {
          ctx._clickAtLast = { key, sig };
        }
      }

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
        // Count successful actions so a bare finish on a step that needed work
        // can be detected (see _verifyStepOutcome). This counts ANY successful
        // tool (including read-only extract/memo), because a step whose output
        // is extracted data or a memo save has done its work even though the
        // page did not change. Only state-changing tools clear the
        // duplicate-click guard below (different concern).
        ctx._stepActions++;
        // Track the last successful click target so a duplicate click in the next
        // round is short-circuited (prevents double-submitting on chat pages).
        if (tc.name === "click" && result.ok) {
          ctx._lastClick = clickTargetKey(tc.args, ctx.lastSnapshot);
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
        // Vision found it AND gave coordinates: hand the agent a concrete,
        // executable hint instead of making it re-fail DOM location. The agent
        // can call click_at to click the exact pixel the model saw.
        if (v.hasCoordinates) {
          emit({ kind: "attempt", action, reason: `视觉定位成功，目标中心 (${v.x}, ${v.y})`, ok: true, attempt });
          ctx.history.push({
            role: "user",
            content: `[系统] 视觉模型在页面上找到了目标元素「${targetDesc}」：目标中心坐标为 (${v.x}, ${v.y})。` +
              `该元素未出现在 DOM 快照中。如果本步骤需要点击该目标，请用 click_at 工具传入 (${v.x}, ${v.y}) 执行点击。`,
          });
          return okFor;
        }
        // Visible but no coordinates: retry the snapshot once more after a beat.
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
// Uses the element's snapshot NAME when available (stable across re-renders —
// a send button's index changes when new content appears, its name usually
// does not), falling back to index or selector.
function clickTargetKey(args, snapshot) {
  const idx = args && args.index;
  if (typeof idx === "number") {
    const el = snapshot && snapshot.elements && snapshot.elements[idx];
    if (el && el.name) return "name:" + el.name;
    return "index:" + idx;
  }
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

// A step that claimed to be done without performing any state-changing action
// AND without any observable page change is suspicious ("said done, did
// nothing"). Returns { ok, reason }. Steps that executed an action, or whose
// page changed (navigation / new content / URL), pass.
async function _verifyStepOutcome(ctx, step) {
  try {
    if ((ctx._stepActions || 0) > 0) return { ok: true, reason: "" };
    const start = ctx._stepStartSnapshot;
    const after = ctx.lastSnapshot || {};
    if (!start) return { ok: true, reason: "" };
    const startUrl = (start.url || "").replace(/#.*$/, "");
    const afterUrl = (after.url || "").replace(/#.*$/, "");
    if (startUrl && afterUrl && startUrl !== afterUrl) return { ok: true, reason: "" };
    const startCount = (start.elements || []).length;
    const afterCount = (after.elements || []).length;
    if (Math.abs(afterCount - startCount) >= 3) return { ok: true, reason: "" };
    return { ok: false, reason: "未执行任何操作且页面没有变化（无导航/无新增元素）" };
  } catch (_) {
    return { ok: true, reason: "" };
  }
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

// Lazy notes factory so executor works in unit tests that don't require notes.js.
function createNotesSession() {
  const notesMod = typeof module !== "undefined" ? require("./notes.js") : globalThis.NotesModule;
  return notesMod.createNotes();
}

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

function notesNote(notes) {
  if (!notes || typeof notes.render !== "function") return "";
  const rendered = notes.render();
  return rendered ? `\n\n${rendered}` : "";
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
  runCtx.notes = ctx.notes || createNotesSession();

  const buildResume = () => ({
    goal: plan.goal,
    plan,
    nextStepIndex: current,
    lastSummary,
    notes: runCtx.notes.size ? runCtx.notes.toJSON() : undefined,
  });
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
      // Replan from the CURRENT step, not from step 0. The new plan replaces
      // only the steps from here onward; already-completed steps stay done so
      // a long task does not re-execute (and re-submit) finished work.
      const newPlan = await ctx.replan(plan.goal, step, {
        done: plan.steps.slice(0, current).map((s) => s.description),
        failed: step.description,
        notes: runCtx.notes.size ? runCtx.notes.toJSON() : null,
      });
      ctx.onLog("plan", "新计划: " + newPlan.steps.map((s, i) => `${i + 1}. ${s.description}`).join(" | "));
      plan.steps = plan.steps.slice(0, current).concat(newPlan.steps);
      runCtx.plan = plan;
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

const executor = { execute, executeStep, buildSystemPrompt, classifyStep, trimHistory, changeNote, notesNote, detectPageRisk, isStateChangingTool, createNotesSession };
if (typeof module !== "undefined") {
  module.exports = executor;
} else {
  globalThis.executor = executor;
}