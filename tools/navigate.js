registerTool({
  name: "navigate",
  description: "Navigate the current tab to a URL. The page will reload afterwards.",
  parameters: {
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
  },
  async execute(args, ctx) {
    return await ctx.bridge.executeAction({ name: "navigate", target: null, args: { url: args.url } });
  },
});
