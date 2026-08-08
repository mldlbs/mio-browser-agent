registerTool({
  name: "memo",
  description: "Store or read task data that spans tabs/sites (verification codes, prices, extracted ids). The data lives in session memory, so it survives tab switches and even replans. Modes: set (save key=value), get (read a key), list (show all), clear (wipe all), remove (delete one key). Prefer memo over relying on conversation history, which may be trimmed.",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["set", "get", "list", "clear", "remove"], description: "Operation to perform" },
      key: { type: "string", description: "Key name for set/get/remove" },
      value: { type: "string", description: "Value to store for mode=set" },
    },
    required: ["mode"],
  },
  async execute(args, ctx) {
    const notes = ctx.notes;
    try {
      switch (args.mode) {
        case "set": {
          if (!args.key) return { ok: false, error: "memo set requires key" };
          if (args.value == null) return { ok: false, error: "memo set requires value" };
          notes.set(args.key, args.value);
          return { ok: true, value: `saved ${args.key} (${notes.size()} notes total)` };
        }
        case "get": {
          if (!args.key) return { ok: false, error: "memo get requires key" };
          const v = notes.get(args.key);
          return v != null ? { ok: true, value: v } : { ok: false, error: `no memo entry for "${args.key}"` };
        }
        case "list": {
          const items = notes.list();
          if (!items.length) return { ok: true, value: "(no notes)" };
          return { ok: true, value: { items, description: items.map((n) => `${n.key}: ${n.value}`).join("\n") } };
        }
        case "remove": {
          if (!args.key) return { ok: false, error: "memo remove requires key" };
          const removed = notes.remove(args.key);
          return removed ? { ok: true, value: `removed ${args.key}` } : { ok: false, error: `no memo entry for "${args.key}"` };
        }
        case "clear": {
          notes.clear();
          return { ok: true, value: "all notes cleared" };
        }
        default:
          return { ok: false, error: `unknown memo mode ${args.mode}` };
      }
    } catch (e) {
      return { ok: false, error: `memo error: ${(e && e.message) || e}` };
    }
  },
});
