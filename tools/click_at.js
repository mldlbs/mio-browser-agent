registerTool({
  name: "click_at",
  description: "Click at raw viewport coordinates (x, y) with a real mouse-event sequence. Use ONLY when the page snapshot cannot find the target (e.g. vision located it at a coordinate, or it is canvas/overlay content the DOM locator misses). Prefer the normal click tool by snapshot index whenever the element is listed.",
  parameters: {
    type: "object",
    properties: {
      x: { type: "integer", description: "Viewport x coordinate (pixels from left)" },
      y: { type: "integer", description: "Viewport y coordinate (pixels from top)" },
    },
    required: ["x", "y"],
  },
  async execute(args, ctx) {
    if (typeof args.x !== "number" || typeof args.y !== "number") {
      return { ok: false, error: "click_at requires numeric x and y" };
    }
    return await ctx.bridge.executeAction({ name: "clickAt", target: null, args: { x: args.x, y: args.y } });
  },
});
