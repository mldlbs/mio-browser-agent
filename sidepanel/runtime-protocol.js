// Runtime Protocol - 统一消息封装
// 所有 Runtime 控制消息使用 versioned envelope

const PROTOCOL_VERSION = 1;

function makeRuntimeMessage(payload) {
  return {
    version: PROTOCOL_VERSION,
    kind: "runtime",
    payload: payload || {}
  };
}

function parseRuntimeMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.kind !== "runtime") return null;
  if (msg.version !== PROTOCOL_VERSION) return null;
  return msg.payload;
}

function makeRecoveryMessage(action, reason = "") {
  return makeRuntimeMessage({
    type: "recovery",
    action,
    reason
  });
}

function parseRecoveryMessage(msg) {
  const payload = parseRuntimeMessage(msg);
  if (!payload || payload.type !== "recovery") return null;
  return payload; // { action, reason }
}

function makeFinishMessage(status, summary = "") {
  return makeRuntimeMessage({
    type: "finish",
    status, // "ok" | "failed"
    summary
  });
}

function parseFinishMessage(msg) {
  const payload = parseRuntimeMessage(msg);
  if (!payload || payload.type !== "finish") return null;
  return payload; // { status, summary }
}

function makeActTurnMessage(toolCalls) {
  return makeRuntimeMessage({
    type: "act",
    toolCalls: toolCalls || []
  });
}

function parseActTurnMessage(msg) {
  const payload = parseRuntimeMessage(msg);
  if (!payload || payload.type !== "act") return null;
  return payload; // { toolCalls: [...] }
}

if (typeof module !== "undefined") {
  module.exports = {
    PROTOCOL_VERSION,
    makeRuntimeMessage,
    parseRuntimeMessage,
    makeRecoveryMessage,
    parseRecoveryMessage,
    makeFinishMessage,
    parseFinishMessage,
    makeActTurnMessage,
    parseActTurnMessage
  };
} else {
  globalThis.RuntimeProtocolModule = {
    PROTOCOL_VERSION,
    makeRuntimeMessage,
    parseRuntimeMessage,
    makeRecoveryMessage,
    parseRecoveryMessage,
    makeFinishMessage,
    parseFinishMessage,
    makeActTurnMessage,
    parseActTurnMessage
  };
}