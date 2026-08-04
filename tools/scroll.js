registerTool({
  name: "scroll",
  description: "Scroll the page. delta is vertical pixels (positive=down, negative=up).",
  parameters: {
    type: "object",
    properties: { delta: { type: "integer" } },
    required: ["delta"],
  },
  async execute(args, ctx) {
    return await ctx.bridge.executeAction({ name: "scroll", target: null, args: { delta: args.delta } });
  },
});
