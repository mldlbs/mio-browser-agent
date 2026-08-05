function createAgentRuntime({ settings, bridge, onLog = () => {}, onRecovery = () => {}, onState = () => {}, deps = {} }) {
  const llm = deps.llm || createAdapter(settings);
  const memory = createMemory();
  let stopRequested = false;

  async function run(goal) {
    onState("planning");
    onLog("plan", "开始规划…");
    try {
      const planDoc = await planner.plan(goal, llm);
      onLog("plan", planDoc.steps.map((s, i) => `${i + 1}. ${s.description}`).join(" | "));
      onState("running");
      const result = await executor.execute(planDoc, {
        llm, bridge, memory, onLog, onRecovery,
        getTool, getToolsSchema,
        replan: (goal2, step) => planner.replan(goal2, step, llm),
        maxTurns: deps.maxTurns || 8,
        maxStepRetries: deps.maxStepRetries || 3,
        maxSteps: deps.maxSteps || 30,
        maxRecoveryAttempts: deps.maxRecoveryAttempts || 2,
        isStopped: () => stopRequested,
      });
      onState(result.ok ? "done" : "error");
      onLog("result", result.summary || result.error || "");
      return result;
    } finally {
      stopRequested = false;
    }
  }

  function stop() { stopRequested = true; }

  return { run, stop };
}

if (typeof module !== "undefined") {
  module.exports = { createAgentRuntime };
}