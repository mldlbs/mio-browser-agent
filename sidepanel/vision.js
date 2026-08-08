// Vision fallback - 恢复引擎的最后一层兜底。
// 只在 DOM 快照 / Accessibility 都失败后启用（默认关闭，由设置开关）。
// 流程：截取当前标签页 → 用视觉模型描述目标元素在页面上的位置 → 返回提示供重新定位。

function buildVisionPrompt(targetDesc) {
  return [
    "你是浏览器自动化的视觉定位器。下面是当前页面的截图（完整视口）。",
    "请在截图中找到目标元素「" + targetDesc + "」，并给出它的**中心点坐标**。",
    "坐标以图片左上角为原点，单位像素，x 向右、y 向下。格式必须严格为：x:<数字>, y:<数字>",
    "例如：x:512, y:360",
    "如果目标真的不在截图里，就回答「不可见」，不要给坐标。",
    "只需输出一行：要么是坐标，要么是「不可见」。不要解释、不要编造坐标。",
  ].join("\n");
}

// Parse the model's free-text answer into a structured hint with coordinates.
// A concrete "x:<num>, y:<num>" pair is the STRONG signal of visibility — it
// overrides any incidental "遮挡/不可见" wording the model may add, since a
// model that gives coordinates has clearly seen the element. Only a bare
// "不可见" answer (no coordinates) counts as invisible.
function parseVisionAnswer(text) {
  const t = (text || "").trim();
  const xMatch = t.match(/\bx\s*[:=]\s*(\d+)/i);
  const yMatch = t.match(/\by\s*[:=]\s*(\d+)/i);
  let x = null, y = null;
  if (xMatch && yMatch) {
    x = parseInt(xMatch[1], 10);
    y = parseInt(yMatch[1], 10);
  }
  const hasCoordinates = x != null && y != null && !isNaN(x) && !isNaN(y);
  if (hasCoordinates) {
    return { visible: true, x, y, hasCoordinates: true, reason: t.slice(0, 200) };
  }
  const lower = t.toLowerCase();
  const invisible = /(不可见|看不见|看不到|没?有找到|没?有出现|未找到|未出现|不存在|遮挡|需要滚动|已跳转|无法定位|不?再显示|无法确定坐标|没有坐标)/i.test(lower);
  return {
    visible: !invisible,
    x: null,
    y: null,
    hasCoordinates: false,
    reason: t.slice(0, 200),
  };
}

// Run a vision pass over the active tab. Returns a VisionResult:
//   { ok, visible, x, y, hasCoordinates, reason, imageUsed }
// ok=false means vision is unavailable or the capture failed.
async function runVisionFallback({ bridge, llm, targetDesc, maxTries = 1 }) {
  try {
    const dataUrl = await bridge.capture();
    if (!dataUrl) return { ok: false, visible: false, reason: "capture failed (no activeTab permission)", imageUsed: false };
    const messages = [{ role: "user", content: buildVisionPrompt(targetDesc) }];
    const resp = await llm.generate(messages, { images: [dataUrl] });
    const answer = (resp.content || "").trim();
    const parsed = parseVisionAnswer(answer);
    return { ok: true, visible: parsed.visible, x: parsed.x, y: parsed.y, hasCoordinates: parsed.hasCoordinates, reason: parsed.reason, imageUsed: true };
  } catch (e) {
    return { ok: false, visible: false, reason: (e && e.message) || String(e), imageUsed: false };
  }
}

// ── send-confirmation: verify a send/submit click actually worked ──
// The DOM click may silently no-op (disabled button, editor state desync), and
// the DOM snapshot may not reflect the new message. Ask the vision model to
// confirm: was the input cleared, or did a new user message appear?

function buildSendConfirmPrompt() {
  return [
    "你正在帮助一个浏览器自动化助手确认「发送」是否成功。",
    "下面是当前聊天页面的截图。请回答两个问题：",
    "1. 输入框里的文字是否已经被清空？",
    "2. 对话区域是否出现了一条新的、刚发送的用户消息？",
    "如果输入框已清空，或出现了新消息，回答：已发送。",
    "如果输入框仍有文字、且没有新消息，回答：未发送。",
    "用一句话回答，以「已发送」或「未发送」开头。",
  ].join("\n");
}

// Parse the send-confirm answer into { sent, reason }.
function parseSendConfirm(text) {
  const t = (text || "").trim();
  const lower = t.toLowerCase();
  const sent = /(已发送|发送成功|已提交|发送出去了|已经发出|消息.*出现|输入框.*清空|已清空)/i.test(lower)
    && !/(未发送|发送失败|没有发送|没发送|未提交|尚未)/i.test(lower);
  return { sent, reason: t.slice(0, 200) };
}

// Run a vision confirm pass. Returns { ok, sent, reason, imageUsed }.
async function runSendConfirm({ bridge, llm, maxTries = 1 }) {
  try {
    const dataUrl = await bridge.capture();
    if (!dataUrl) return { ok: false, sent: false, reason: "capture failed (no activeTab permission)", imageUsed: false };
    const messages = [{ role: "user", content: buildSendConfirmPrompt() }];
    const resp = await llm.generate(messages, { images: [dataUrl] });
    const answer = (resp.content || "").trim();
    const parsed = parseSendConfirm(answer);
    return { ok: true, sent: parsed.sent, reason: parsed.reason, imageUsed: true };
  } catch (e) {
    return { ok: false, sent: false, reason: (e && e.message) || String(e), imageUsed: false };
  }
}

const vision = { buildVisionPrompt, parseVisionAnswer, runVisionFallback, buildSendConfirmPrompt, parseSendConfirm, runSendConfirm };
if (typeof module !== "undefined") {
  module.exports = vision;
} else {
  globalThis.VisionModule = vision;
}
