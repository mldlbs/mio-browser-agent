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

async function plan(goal, llm) {
  const resp = await llm.generate(
    [{ role: "system", content: PLAN_PROMPT }, { role: "user", content: `Goal: ${goal}` }],
    { tools: PLAN_TOOLS }
  );
  const steps = parsePlanResponse(resp);
  if (!steps.length) return { goal, steps: [{ description: goal }] };
  return { goal, steps };
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
  const resp = await llm.generate(
    [
      { role: "system", content: PLAN_PROMPT },
      { role: "user", content: `Goal: ${goal}\n\nThe step below failed repeatedly:\n"${failedStep.description}"\nSubmit a revised plan for the REMAINING work only, starting from the failed step onward.${doneText}${notesText}\nDo not include already-completed steps in the new plan.` },
    ],
    { tools: PLAN_TOOLS }
  );
  const steps = parsePlanResponse(resp);
  if (!steps.length) throw new Error("replan produced no steps");
  return { goal, steps };
}

const planner = { plan, replan, parsePlanResponse };
if (typeof module !== "undefined") {
  module.exports = planner;
} else {
  globalThis.planner = planner;
}
