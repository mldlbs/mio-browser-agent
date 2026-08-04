registerTool({
  name: "click",
  description: "Click an element by its index in the page snapshot. clickCount 1=single, 2=double.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "integer", description: "Element index from the snapshot" },
      clickCount: { type: "integer", description: "1 or 2", default: 1 },
    },
    required: ["index"],
  },
  async execute(args, ctx) {
    const target = ctx.snapshot.elements[args.index];
    if (!target) return { ok: false, error: `no element at index ${args.index}` };
    return await ctx.bridge.executeAction({ name: "click", target, args: { clickCount: args.clickCount || 1 } });
  },
});
