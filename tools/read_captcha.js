// read_captcha tool — screenshot the page and read the canvas-drawn captcha code.
// Needed because canvas captchas (login verification codes) have no DOM text an
// agent could extract: the only way to read them is to capture the page and ask
// a vision-capable model. Pairs with the snapshot now listing <canvas> elements.
registerTool({
  name: "read_captcha",
  description: "Screenshot the visible page and read the captcha code drawn on the canvas (usually 4 alphanumeric characters). Use when a login form has a canvas captcha image that must be entered before submitting.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(args, ctx) {
    const llm = ctx && ctx.llm;
    if (!llm) return { ok: false, error: "llm unavailable for vision read" };
    const dataUrl = await ctx.bridge.capture();
    if (!dataUrl) return { ok: false, error: "capture failed (no activeTab permission)" };
    const prompt = [
      "你正在帮助浏览器自动化助手读取登录页的图形验证码。",
      "截图里有一张 canvas 绘制的小图（通常 4 位字母/数字，可能有干扰线）。",
      "请只回答验证码图片上显示的字符序列（例如 3K9f），不要包含任何其他文字。",
      "如果图片上看不清、被遮挡或无法确定，只回答：UNREADABLE",
    ].join("\n");
    let answer = "";
    try {
      const resp = await llm.generate([{ role: "user", content: prompt }], { images: [dataUrl] });
      answer = ((resp && resp.content) || "").trim().replace(/\s+/g, "");
    } catch (e) {
      return { ok: false, error: "vision read failed: " + ((e && e.message) || String(e)) };
    }
    if (!answer || /^(unreadable|无法|看不清|识别失败)$/i.test(answer)) {
      return { ok: false, error: "captcha unreadable from screenshot" };
    }
    return { ok: true, value: answer };
  },
});
