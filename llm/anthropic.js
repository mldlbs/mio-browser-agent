// Anthropic Messages API adapter (Claude models). Implements the same
// `generate(messages, { tools, images })` contract as the OpenAI adapter:
//   - system messages are lifted out of `messages` into the top-level `system`
//     field (Anthropic does not accept system inside messages)
//   - assistant `tool_calls` become `tool_use` content blocks
//   - `role: "tool"` results become `tool_result` blocks inside a user message
//   - images are sent as base64 source blocks
// Response is normalized to `{ content, toolCalls: [{id,name,args}] }`.

const ANTHROPIC_VERSION = "2023-06-01";

function splitSystem(messages) {
  const system = [];
  const rest = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") system.push(m.content);
    } else {
      rest.push(m);
    }
  }
  return { system: system.join("\n\n"), messages: rest };
}

function toAnthropicMessages(messages, images) {
  const out = [];
  for (const m of messages) {
    if (m.role === "system") continue; // handled via top-level system field
    if (m.role === "assistant") {
      if (m.tool_calls && m.tool_calls.length) {
        const blocks = [];
        if (m.content) blocks.push({ type: "text", text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
        for (const tc of m.tool_calls) {
          let args = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch (_) { args = {}; }
          blocks.push({
            type: "tool_use",
            id: tc.id || ("call_" + Math.random().toString(36).slice(2, 10)),
            name: tc.function.name,
            input: args,
          });
        }
        out.push({ role: "assistant", content: blocks });
      } else {
        out.push({ role: "assistant", content: [{ type: "text", text: typeof m.content === "string" ? m.content : (m.content || "") }] });
      }
      continue;
    }
    if (m.role === "tool") {
      // tool result: content is a JSON string already (e.g. {"ok":true,...}).
      // Wrap it in a tool_result block on a user message so the conversation
      // alternates cleanly (assistant tool_use -> user tool_result).
      const last = out[out.length - 1];
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.some((c) => c.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }
    // user message
    const text = typeof m.content === "string" ? m.content : (m.content && m.content.text) || JSON.stringify(m.content);
    if (m.role === "user" && images && images.length) {
      out.push({
        role: "user",
        content: [
          { type: "text", text },
          ...images.map((url) => {
            const match = /^data:(image\/[a-z]+);base64,(.+)$/.exec(url || "");
            if (match) {
              return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
            }
            return { type: "image", source: { type: "url", url } };
          }),
        ],
      });
    } else {
      out.push({ role: "user", content: [{ type: "text", text }] });
    }
  }
  return out;
}

function toAnthropicTools(tools) {
  return (tools || []).map((t) => {
    const fn = t.function || {};
    return {
      name: fn.name,
      description: fn.description || "",
      input_schema: fn.parameters || { type: "object", properties: {} },
    };
  });
}

function parseToolUses(content) {
  if (!Array.isArray(content)) return [];
  const calls = [];
  for (const block of content) {
    if (block.type === "tool_use") {
      calls.push({ id: block.id, name: block.name, args: block.input || {} });
    }
  }
  return calls;
}

const createAnthropicAdapter = (settings) => {
  const baseURL = (settings.baseURL || "https://api.anthropic.com/v1").replace(/\/$/, "");
  const apiKey = settings.apiKey || "";
  const model = settings.model || "claude-3-5-sonnet-latest";
  const maxRetries = 3;

  async function post(body) {
    const timeoutMs = 60000;
    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseURL}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
          err.retriable = res.status === 429 || res.status >= 500;
          throw err;
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        if (e.retriable === false) throw e;
        if (e && e.name === "AbortError") {
          lastErr = new Error(`LLM 请求超时 (${timeoutMs / 1000}s)`);
          lastErr.retriable = true;
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    async generate(messages, opts = {}) {
      const { system, messages: rest } = splitSystem(messages);
      const body = {
        model,
        max_tokens: 4096,
        temperature: 0.2,
        messages: toAnthropicMessages(rest, opts.images),
      };
      if (system) body.system = system;
      const tools = toAnthropicTools(opts.tools);
      if (tools.length) body.tools = tools;
      const data = await post(body);
      const content = data.content || [];
      const textParts = content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      return { content: textParts, toolCalls: parseToolUses(content) };
    },
  };
};

registerProvider("anthropic", createAnthropicAdapter);
