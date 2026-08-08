// Recovery events - structured "why it failed / what we tried / how it ended"
// stream for UI transparency. Pure data + pure renderer (unit-testable).

function startEvents() {
  return { stepId: null, errorCode: null, message: "", attempts: [], outcome: null };
}

function addEvent(events, event) {
  if (!events) return events;
  if (event.kind === "error") {
    events.stepId = event.stepId;
    events.errorCode = event.code || "UNKNOWN";
    events.message = event.message || "";
  } else if (event.kind === "attempt") {
    events.attempts.push({ action: event.action, reason: event.reason || "", ok: !!event.ok, attempt: event.attempt });
  } else if (event.kind === "outcome") {
    events.outcome = event.outcome || "unknown";
  }
  return events;
}

function renderEventStream(events) {
  if (!events || !events.errorCode) return "";
  const lines = [];
  // stepId is the 0-based plan index (or an explicit step id). Show a
  // human-readable 1-based step number when it is a number.
  const stepNum = typeof events.stepId === "number" && isFinite(events.stepId) ? events.stepId + 1 : events.stepId;
  const step = stepNum != null ? `[步骤 ${stepNum}] ` : "";
  lines.push(`${step}❌ ${events.errorCode}${events.message ? ": " + events.message : ""}`);
  if (events.attempts.length) {
    lines.push("恢复:");
    for (const a of events.attempts) {
      const mark = a.ok ? "✓" : "✗";
      lines.push(`  ${mark} ${a.action}${a.reason ? "（" + a.reason + "）" : ""}`);
    }
  }
  if (events.outcome) {
    const label = events.outcome === "recovered" ? "✓ 已恢复，继续执行" :
      events.outcome === "exhausted" ? "✗ 恢复用尽，步骤失败" : events.outcome;
    lines.push("结果: " + label);
  }
  return lines.join("\n");
}

if (typeof module !== "undefined") {
  module.exports = { startEvents, addEvent, renderEventStream };
} else {
  globalThis.RecoveryEventsModule = { startEvents, addEvent, renderEventStream };
}
