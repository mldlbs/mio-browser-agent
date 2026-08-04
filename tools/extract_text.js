registerTool({
  name: "extract_text",
  description: "Read the readable text of the current page (title, url, body/article text). Use this to read articles, novel chapters, or page content that the snapshot does not include. Returns trimmed text, capped at maxChars.",
  parameters: {
    type: "object",
    properties: { maxChars: { type: "integer", description: "Maximum characters to return (default 4000)" } },
  },
  async execute(args, ctx) {
    return await ctx.bridge.executeAction({ name: "extract_text", target: null, args: { maxChars: args.maxChars || 4000 } });
  },
});
