const createOpenAIAdapter = (settings) => {
  const baseURL = (settings.baseURL || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiKey = settings.apiKey || "";
  const model = settings.model || "gpt-4o-mini";
  const maxRetries = 3;

  async function post(body) {
    const timeoutMs = 60000;
    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
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
      const body = { model, messages, temperature: 0.2 };
      if (opts.tools && opts.tools.length) body.tools = opts.tools;
      const data = await post(body);
      const msg = data.choices && data.choices[0] && data.choices[0].message;
      if (!msg) throw new Error("LLM response missing choices");
      return normalizeCompletion(msg);
    },
  };
};

registerProvider("openai", createOpenAIAdapter);
registerProvider("deepseek", createOpenAIAdapter);
