registerTool({
  name: "wait",
  description: "Wait for a condition or a fixed duration before the next action. Use condition waiting (selector/text/urlContains) instead of fixed sleeps when you know what should appear, e.g. after clicking a button or navigating. Options: ms (fixed delay), selector (CSS selector appears), text (page text contains), urlContains (URL contains), disappear (wait for the above to go away, default false), timeout (ms, default 8000).",
  parameters: {
    type: "object",
    properties: {
      ms: { type: "integer", description: "Fixed delay in milliseconds" },
      selector: { type: "string", description: "Wait until this CSS selector matches" },
      text: { type: "string", description: "Wait until the page text contains this string" },
      urlContains: { type: "string", description: "Wait until the URL contains this substring" },
      disappear: { type: "boolean", description: "Wait for the condition to be false instead of true" },
      timeout: { type: "integer", description: "Max wait in ms (default 8000)" },
    },
  },
  async execute(args, ctx) {
    if (args.ms != null && !args.selector && !args.text && !args.urlContains) {
      await new Promise((r) => setTimeout(r, Math.max(0, args.ms)));
      return { ok: true, value: `waited ${args.ms}ms` };
    }
    return await ctx.bridge.executeAction({ name: "waitFor", target: null, args });
  },
});
