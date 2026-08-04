registerTool({
  name: "type",
  description: "Type text into an input-like element by snapshot index. clear=true erases existing content first.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "integer" },
      text: { type: "string" },
      clear: { type: "boolean", default: true },
    },
    required: ["index", "text"],
  },
  async execute(args, ctx) {
    const target = ctx.snapshot.elements[args.index];
    if (!target) return { ok: false, error: `no element at index ${args.index}` };
    return await ctx.bridge.executeAction({
      name: "type",
      target,
      args: { text: String(args.text), clear: args.clear !== false },
    });
  },
});
