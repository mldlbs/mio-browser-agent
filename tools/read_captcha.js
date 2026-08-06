// read_captcha tool — read the login verification code (验证码/captcha) from the
// canvas/img. Two capture paths: the exact canvas bitmap (via captureCanvas,
// crisp) or a full-page screenshot (fallback). The answer is validated as exactly
// 4 alphanumeric characters and re-read once before giving up.
registerTool({
  name: "read_captcha",
  description: "Read the login verification code (验证码/captcha) drawn on the canvas or img — usually 4 alphanumeric characters. This is the ONLY tool for reading captchas. Optionally pass the captcha element's snapshot index to read its exact bitmap; without one it auto-locates a captcha-like canvas/img. If the code looks unreadable, click the captcha image first to refresh it, then call read_captcha again. Never declare a captcha unreadable before calling this at least once.",
  parameters: {
    type: "object",
    properties: {
      index: { type: "integer", description: "Optional snapshot index of the captcha canvas/img element" },
    },
    required: [],
  },
  async execute(args, ctx) {
    const llm = ctx && ctx.llm;
    if (!llm) return { ok: false, error: "llm unavailable for vision read" };
    const snap = ctx.snapshot;
    let target = null;
    if (args && typeof args.index === "number" && snap && snap.elements) {
      const arr = snap.elements;
      if (arr[args.index]) target = arr[args.index];
      if (!target || !target.cssPath) {
        const found = arr.find((e) => e.index === args.index);
        if (found) target = found;
      }
    }
    const attempts = [
      () => (ctx.bridge && ctx.bridge.captureCanvas ? ctx.bridge.captureCanvas(target) : null),
      () => (ctx.bridge ? ctx.bridge.capture() : null),
    ];
    let lastErr = "";
    let hadDataUrl = false;
    for (const attempt of attempts) {
      let dataUrl = null;
      try { dataUrl = await attempt(); } catch (_) {}
      if (!dataUrl) continue;
      hadDataUrl = true;
      for (let retry = 0; retry < 2; retry++) {
        const read = await readCode(llm, dataUrl);
        if (read.ok) return read;
        lastErr = read.error;
      }
    }
    if (!hadDataUrl) return { ok: false, error: "capture failed (no activeTab permission or captcha element not found)" };
    return { ok: false, error: "captcha unreadable from screenshot" + (lastErr ? ": " + lastErr : "") };
  },
});

async function readCode(llm, dataUrl) {
  const prompt = [
    "你正在读取登录页的图形验证码（验证码/captcha）。",
    "验证码由 canvas 或图片绘制，严格 4 位字符（字母和/或数字混合），可能有干扰线/噪点。",
    "只回答验证码上显示的恰好 4 个字符（例如 3K9f）。",
    "如果识别结果不是恰好 4 个字母数字字符、或看不清、被遮挡、无法确定，只回答：UNREADABLE",
  ].join("\n");
  let answer = "";
  try {
    const resp = await llm.generate([{ role: "user", content: prompt }], { images: [dataUrl] });
    answer = ((resp && resp.content) || "").trim().replace(/\s+/g, "");
  } catch (e) {
    return { ok: false, error: "vision read failed: " + ((e && e.message) || String(e)) };
  }
  if (/^(unreadable|无法|看不清|识别失败)$/i.test(answer)) {
    return { ok: false, error: "model reported unreadable" };
  }
  const clean = (answer.match(/[A-Za-z0-9]/g) || []).join("");
  if (clean.length !== 4) {
    return { ok: false, error: "expected exactly 4 chars, got '" + clean + "'" };
  }
  return { ok: true, value: clean };
}
