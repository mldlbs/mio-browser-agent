registerTool({
  name: "navigate",
  description: "Navigate the current tab to a URL. The page will reload afterwards.",
  parameters: {
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
  },
  async execute(args, ctx) {
    if (!args.url) return { ok: false, error: "navigate requires url" };
    // Browser-level navigation (chrome.tabs.update) works from any page,
    // including chrome://new-tab / view-source where the content script is
    // unavailable. Fall back to the in-page location change if it fails.
    if (ctx.bridge && typeof ctx.bridge.navigate === "function") {
      try {
        return await ctx.bridge.navigate(args.url);
      } catch (e) {
        // fall through to content-script navigation
      }
    }
    return await ctx.bridge.executeAction({ name: "navigate", target: null, args: { url: args.url } });
  },
});
