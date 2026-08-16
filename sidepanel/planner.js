const PLAN_PROMPT = "You are a web automation planner. Decompose the user goal into a concise, ordered list of steps. Each step must be achievable on a web page (navigate, click, type, wait, extract, open a tab, switch tabs). Do not add steps that require anything outside the browser.\n\nGuidelines:\n- Prefer a small number of coarse steps (3-8).\n- Collapse repetitive same-type work into ONE step: e.g. for a list of 11 products, use a single step 'Search for each item in the list, open its detail page, and add it to the cart', not 11 separate steps.\n- Do not create a separate step for every item, keyword, or minor navigation.\n- Each step should describe the goal of that phase, not low-level clicks.\n- Tasks can span MULTIPLE sites or pages. When a goal needs data from one site to be used on another (e.g. a verification code from email, a price from one shop applied on another, an order id from an order page pasted into a ticket form), plan explicit phases: extract the data on the source page, then switch/open the target page and use it there. The agent can open tabs with the tab tool and save data across tabs with the memo tool, so mention that in the step text (e.g. '在邮箱页打开验证码邮件，用 memo 保存验证码' then '切到登录页，从 memo 读取验证码并输入').\n- Do not assume data gathered on an earlier page will still be visible later; make steps that carry data between pages explicit.";

const PLAN_TOOLS = [{
  type: "function",
  function: {
    name: "submit_plan",
    description: "Submit the ordered step list for the web automation task.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "object", properties: { description: { type: "string" } }, required: ["description"] },
        },
      },
      required: ["steps"],
    },
  },
}];

function parsePlanResponse(resp) {
  const tc = (resp.toolCalls || []).find((c) => c.name === "submit_plan");
  const steps = (tc && Array.isArray(tc.args.steps) ? tc.args.steps : [])
    .filter((s) => s && typeof s.description === "string" && s.description.trim())
    .map((s) => ({ description: s.description.trim() }));
  return steps;
}

// Split a goal that EXPLICITLY declares numbered stages/phases into one step
// per stage. Long multi-phase tasks (e.g. "阶段1…阶段2…阶段3…") collapse into a
// single LLM plan step far too often, which kills per-stage recovery: one
// failed action fails the WHOLE task and everything re-runs from scratch.
// Detecting the explicit stage markers client-side is a cheap, deterministic
// guard the LLM can't skip. Returns [] when no stage markers are found.
function splitStages(goal) {
  const text = String(goal || "");
  // Match "阶段N" / "步骤N" / "Phase N" / "Stage N" / "Step N" (also 阶段 N with space).
  const re = /(?:阶段|步骤|第[一二三四五六七八九十\d]+步|Phase|Stage|Step)\s*(\d+|[一二三四五六七八九十])/gi;
  const matches = [];
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    if (matches.length && start === matches[matches.length - 1].start) continue;
    matches.push({ start, label: m[0] });
  }
  if (matches.length < 2) return [];
  const descs = [];
  for (let i = 0; i < matches.length; i++) {
    const from = matches[i].start;
    const to = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const chunk = text.slice(from, to).trim();
    if (chunk) descs.push(chunk.slice(0, 400));
  }
  // Only treat it as a staged plan if there are at least 2 non-empty chunks,
  // and the markers look like a deliberate structure (labels ordered).
  if (descs.length < 2) return [];
  return descs.map((d) => ({ description: d }));
}

async function plan(goal, llm) {
  const resp = await llm.generate(
    [{ role: "system", content: PLAN_PROMPT }, { role: "user", content: `Goal: ${goal}` }],
    { tools: PLAN_TOOLS }
  );
  const steps = parsePlanResponse(resp);
  // If the LLM collapsed a staged goal into a single step, fall back to the
  // explicit stage boundaries so each phase is independently retryable.
  if (steps.length <= 1) {
    const staged = splitStages(goal);
    if (staged.length >= 2) return { goal, steps: staged };
  }
  if (!steps.length) return { goal, steps: [{ description: goal }] };
  return { goal, steps };
}

// Guidance injected into a replan prompt when a step failed with a known,
// actionable error code. Each entry explains what went wrong and how the
// revised plan should avoid repeating the same dead end.
const REPLAN_FAILURE_GUIDANCE = {
  SCROLL_AT_END: "页面已经滚动到底/顶，继续滚动不可能到达目标。改用一个不依赖滚动的策略：目标可能已在快照中（直接点），或在快照外但视觉可见（用 find_by_vision 定位坐标后 click_at）。不要在新计划中再次让 agent 反复滚动。",
  ELEMENT_DISABLED: "目标元素处于禁用/未同步状态（通常是 React 或编辑器状态未就绪）。新计划应在点击前先等待（wait 工具）让状态同步，或改用其它可达的同功能元素/入口。",
  FIELD_NOT_FOUND: "表单字段未能匹配（字段语义没对上，或表单尚未渲染）。新计划应先用快照确认表单已加载、核对字段的实际 label/placeholder，再用正确的字段名填充，或改用 type 按索引直接输入。",
  SUBMIT_NOT_FOUND: "未能识别表单的提交按钮。新计划应改用快照中的按钮索引直接点击，或用 find_by_vision 定位可见的提交按钮。",
  CLICK_AT_UNVERIFIED: "按坐标点击后页面没有任何变化，说明该坐标处没有目标。不要继续猜测坐标，改用快照索引点击，或 find_by_vision 重新精确定位。",
  SEND_NOT_VERIFIED: "点击发送后未能确认消息发出。新计划应在发送后显式等待并验证（观察输入框清空/新回复出现）。",
  // 步骤在 turn 数内耗尽却无进展（观察→决策循环空转）。这是复杂任务反复
  // 重试/重规划的主因：replan 必须引导 LLM 换一种明确、收敛的执行方式。
  STEP_TURNS_EXHAUSTED: "上一步反复尝试但一直没有进展（每次只观察或做无效小动作，迟迟未完成）。新计划必须为这一步给出一个明确收敛的做法：把该步骤拆成更小的可独立完成的动作，每一步只做一个明确的工具调用并尽快 finish；不要在计划里让 agent 反复观察、等待或重试同一动作。若该步骤依赖的页面还没加载好，先用 navigate/wait 明确等到页面就绪再操作。",
};

function replanGuidance(errorCode) {
  return REPLAN_FAILURE_GUIDANCE[errorCode] || "";
}

async function replan(goal, failedStep, llm, ctx) {
  const done = (ctx && ctx.done) || [];
  const doneText = done.length
    ? `\nAlready completed steps (do not repeat them):\n${done.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";
  const notes = (ctx && ctx.notes) || null;
  const notesText = notes && Object.keys(notes).length
    ? `\nSession data already gathered (reuse it with memo, do not re-extract):\n${Object.entries(notes).map(([k, v]) => `${k}: ${v}`).join("\n")}`
    : "";
  const errorCode = (ctx && ctx.failedError) || "";
  const guidance = replanGuidance(errorCode);
  const failText = errorCode || (ctx && ctx.failedReason)
    ? `\nIt failed with: ${errorCode ? `[${errorCode}] ` : ""}${(ctx && ctx.failedReason) || ""}`
    : "";
  const guidanceText = guidance ? `\n${guidance}` : "";
  const resp = await llm.generate(
    [
      { role: "system", content: PLAN_PROMPT },
      { role: "user", content: `Goal: ${goal}\n\nThe step below failed repeatedly:\n"${failedStep.description}"\nSubmit a revised plan for the REMAINING work only, starting from the failed step onward.${doneText}${notesText}${failText}${guidanceText}\nDo not include already-completed steps in the new plan.` },
    ],
    { tools: PLAN_TOOLS }
  );
  const steps = parsePlanResponse(resp);
  if (!steps.length) throw new Error("replan produced no steps");
  return { goal, steps };
}

const planner = { plan, replan, parsePlanResponse, replanGuidance, splitStages };
if (typeof module !== "undefined") {
  module.exports = planner;
} else {
  globalThis.planner = planner;
}
