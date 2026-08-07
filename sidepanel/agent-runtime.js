function createAgentRuntime({ settings, bridge, onLog = () => {}, onRecovery = () => {}, onState = () => {}, onProgress = () => {}, deps = {} }) {
  const llm = deps.llm || createAdapter(settings);
  const memory = createMemory();
  let stopRequested = false;

  // Vision fallback uses its own adapter when the user configured a dedicated
  // vision model; otherwise it reuses the main conversation model (legacy).
  let visionLlm = null;
  try {
    const v = settings.vision || {};
    if (v.model && v.apiKey) visionLlm = deps.visionLlm || createAdapter({ ...v, provider: v.provider || "openai" });
    else visionLlm = deps.visionLlm || null;
  } catch (_) {
    visionLlm = deps.visionLlm || null;
  }

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
        replan: (goal2, step, ctx2) => planner.replan(goal2, step, llm, ctx2),
        maxTurns: deps.maxTurns || 8,
        maxStepRetries: deps.maxStepRetries || 3,
        maxSteps: deps.maxSteps || 30,
        maxRecoveryAttempts: deps.maxRecoveryAttempts || 2,
        verifyStepOutcome: true,
        enableVision: !!settings.enableVision,
        visionLlm,
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