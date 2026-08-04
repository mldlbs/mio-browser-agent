const providers = {};

function registerProvider(name, factory) {
  providers[name] = factory;
}

function createAdapter(settings) {
  let factory = providers[settings.provider];
  if (!factory && providers.openai) factory = providers.openai;
  if (!factory) throw new Error(`Unknown LLM provider: ${settings.provider}. Available: ${Object.keys(providers).join(", ") || "(none)"}`);
  return factory(settings);
}

function normalizeToolCalls(toolCalls) {
  return (toolCalls || []).map((tc) => {
    let args = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch (_) {
      args = { _parseError: String(tc.function.arguments).slice(0, 200) };
    }
    return { id: tc.id, name: tc.function.name, args };
  });
}

function normalizeCompletion(msg) {
  return { content: msg.content || "", toolCalls: normalizeToolCalls(msg.tool_calls) };
}

if (typeof module !== "undefined") {
  module.exports = { registerProvider, createAdapter, normalizeToolCalls, normalizeCompletion };
}
