const PLAN_PROMPT = "You are a web automation planner. Decompose the user goal into a concise, ordered list of steps. Each step must be achievable on a web page (navigate, click, type, wait, extract). Do not add steps that require anything outside the browser.\n\nGuidelines:\n- Prefer a small number of coarse steps (3-8).\n- Collapse repetitive same-type work into ONE step: e.g. for a list of 11 products, use a single step 'Search for each item in the list, open its detail page, and add it to the cart', not 11 separate steps.\n- Do not create a separate step for every item, keyword, or minor navigation.\n- Each step should describe the goal of that phase, not low-level clicks.";

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

async function replan(goal, failedStep, llm) {
  const resp = await llm.generate(
    [
      { role: "system", content: PLAN_PROMPT },
      { role: "user", content: `Goal: ${goal}\n\nThe step below failed repeatedly:\n"${failedStep.description}"\nSubmit a revised plan that fixes the problem.` },
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
