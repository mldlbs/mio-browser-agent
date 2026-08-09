registerTool({
  name: "type",
  description: "Type text into an input-like element. Provide snapshot index, or field=语义键 (e.g. username/password) to locate the matching field by label/placeholder. clear=true erases existing content first.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "integer", description: "Element index from the snapshot (mutually exclusive with field)" },
      field: { type: "string", description: "Semantic field key resolved via label/placeholder (mutually exclusive with index)" },
      text: { type: "string" },
      clear: { type: "boolean", default: true },
    },
    required: ["text"],
  },
  async execute(args, ctx) {
    const elements = ctx.snapshot.elements;
    let target = null;
    if (args.index != null && args.field != null) {
      return { ok: false, error: "type accepts index OR field, not both" };
    }
    if (args.field != null) {
      const fieldsMod = typeof module !== "undefined" ? require("../common/fields.js") : globalThis.FieldsModule;
      let best = null;
      let bestQ = 0;
      for (const el of elements) {
        const m = fieldsMod.matchField(args.field, el);
        const score = m.quality === "exact" ? 3 : m.quality === "synonym" ? 2 : 0;
        if (score > bestQ) { bestQ = score; best = el; }
      }
      if (!best) return { ok: false, error: `no snapshot field matched "${args.field}"` };
      target = best;
    } else if (args.index != null) {
      target = elements[args.index];
      if (!target) return { ok: false, error: `no element at index ${args.index}` };
    } else {
      return { ok: false, error: "type requires index or field" };
    }
    return await ctx.bridge.executeAction({
      name: "type",
      target,
      args: { text: String(args.text), clear: args.clear !== false },
    });
  },
});
