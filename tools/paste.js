registerTool({
  name: "paste",
  description: "Paste large text (e.g. an article or novel chapter) into an element, replacing or appending its content. Use for contenteditable editors, textareas, or inputs where 'type' is impractical for long text.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "integer", description: "Element index from the snapshot" },
      text: { type: "string", description: "Text to paste" },
      clear: { type: "boolean", description: "Replace existing content (default false = append)" },
    },
    required: ["index", "text"],
  },
  async execute(args, ctx) {
    const target = ctx.snapshot.elements[args.index];
    if (!target) return { ok: false, error: `no element at index ${args.index}` };
    return await ctx.bridge.executeAction({ name: "paste", target, args: { text: args.text, clear: !!args.clear } });
  },
});
