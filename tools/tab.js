registerTool({
  name: "tab",
  description: "Manage browser tabs. Modes: open (create a new tab at url and focus it), list (return all open tabs with index/title/url), switch (focus the tab at index), close (close the tab at index). Use list first to see tab indices.",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["open", "list", "switch", "close"], description: "Operation to perform" },
      url: { type: "string", description: "URL for mode=open" },
      index: { type: "integer", description: "Tab index for switch/close" },
    },
    required: ["mode"],
  },
  async execute(args, ctx) {
    const bridge = ctx.bridge;
    try {
      switch (args.mode) {
        case "open": {
          if (!args.url) return { ok: false, error: "tab open requires url" };
          const t = await bridge.tabNew(args.url);
          return { ok: true, value: `opened tab ${t.index}: ${t.url}` };
        }
        case "list": {
          const tabs = await bridge.tabList();
          const desc = tabs.length ? tabs.map((t) => `[${t.index}] ${t.title || "(无标题)"} ${t.url}${t.active ? " (active)" : ""}`).join("\n") : "(no tabs)";
          return { ok: true, value: { tabs, description: desc } };
        }
        case "switch": {
          const r = await bridge.tabSwitch(args.index);
          return r.ok ? { ok: true, value: `switched to: ${r.title}` } : r;
        }
        case "close": {
          const r = await bridge.tabClose(args.index);
          return r.ok ? { ok: true, value: `closed tab: ${r.closed}` } : r;
        }
        default:
          return { ok: false, error: `unknown tab mode ${args.mode}` };
      }
    } catch (e) {
      return { ok: false, error: `tab error: ${(e && e.message) || e}` };
    }
  },
});
