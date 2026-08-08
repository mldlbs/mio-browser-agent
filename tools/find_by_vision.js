registerTool({
  name: "find_by_vision",
  description: "Locate a target element by SIGHT using the vision model, when the DOM snapshot cannot find it (dynamic/canvas/overlay content, text visible on the page but no matching interactive element). Returns the target's center viewport coordinates (x, y) if the vision model sees it, so you can then call click_at with those coordinates. Requires Vision to be enabled and configured. Use ONLY when the target is NOT in the snapshot list but you believe it is visible.",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Describe the target element precisely (its visible text or appearance) so the vision model can find it" },
    },
    required: ["target"],
  },
  async execute(args, ctx) {
    const visionMod = typeof module !== "undefined" ? require("../sidepanel/vision.js") : globalThis.VisionModule;
    if (!visionMod || !visionMod.runVisionFallback) {
      return { ok: false, error: "vision module unavailable", errorCode: "VISION_UNAVAILABLE" };
    }
    if (!ctx.enableVision) {
      return { ok: false, error: "vision is disabled — enable Vision in settings to use find_by_vision", errorCode: "VISION_UNAVAILABLE" };
    }
    if (!ctx.bridge || typeof ctx.bridge.capture !== "function") {
      return { ok: false, error: "vision requires a capture-capable bridge", errorCode: "VISION_UNAVAILABLE" };
    }
    if (!ctx.llm) {
      return { ok: false, error: "no vision model configured — enable Vision in settings", errorCode: "VISION_UNAVAILABLE" };
    }
    const target = (args && args.target) || "";
    if (!target.trim()) return { ok: false, error: "find_by_vision requires a target description" };
    const v = await visionMod.runVisionFallback({ bridge: ctx.bridge, llm: ctx.llm, targetDesc: target.trim().slice(0, 120) });
    if (!v.ok) return { ok: false, error: "vision failed: " + (v.reason || "unknown"), errorCode: "VISION_FAILED" };
    if (!v.visible) return { ok: false, error: "vision reports the target is NOT visible: " + (v.reason || ""), errorCode: "VISION_TARGET_HIDDEN" };
    if (!v.hasCoordinates) return { ok: false, error: "vision sees the target but gave no coordinates: " + (v.reason || ""), errorCode: "VISION_NO_COORDS" };
    return { ok: true, value: { x: v.x, y: v.y, description: `目标中心 (${v.x}, ${v.y})，用 click_at (${v.x}, ${v.y}) 点击` } };
  },
});
