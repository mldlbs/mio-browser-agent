function createAgentRuntime({ settings, bridge, onLog = () => {}, onRecovery = () => {}, onState = () => {}, onProgress = () => {}, deps = {} }) {
  const llm = deps.llm || createAdapter(settings);
  const memory = createMemory();
  let stopRequested = false;

  async function run(goal, resume) {
    onState("planning");
    onLog("plan", resume && resume.plan ? "继续上次任务…" : "开始规划…");
    try {
      let planDoc;
      if (resume && resume.plan) {
        planDoc = resume.plan;
      } else {
        planDoc = await planner.plan(goal, llm);
      }
      onLog("plan", planDoc.steps.map((s, i) => `${i + 1}. ${s.description}`).join(" | "));
      onState("running");
      const result = await executor.execute(planDoc, {
        llm, bridge, memory, onLog, onRecovery, onProgress,
        getTool, getToolsSchema,
        startStep: (resume && resume.nextStepIndex) || 0,
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