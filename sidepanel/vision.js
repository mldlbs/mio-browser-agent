// Vision fallback - 恢复引擎的最后一层兜底。
// 只在 DOM 快照 / Accessibility 都失败后启用（默认关闭，由设置开关）。
// 流程：截取当前标签页 → 用视觉模型描述目标元素在页面上的位置 → 返回提示供重新定位。

function buildVisionPrompt(targetDesc) {
  return [
    "你正在帮助一个浏览器自动化助手。DOM 快照里找不到目标元素。",
    "下面是当前页面的截图。请回答两个问题：",
    "1. 目标元素「" + targetDesc + "」是否可见地出现在页面上？",
    "2. 如果可见，它大概在页面哪个区域（顶部/中部/底部），附近有什么文字或可点击的按钮？",
    "如果不可见（被弹窗遮挡、需要滚动、或页面已跳转），明确说不可见并说明原因。",
    "用简洁的中文回答，不超过 3 句话。",
  ].join("\n");
}

// Parse the model's free-text answer into a structured hint.
function parseVisionAnswer(text) {
  const t = (text || "").trim();
  const lower = t.toLowerCase();
  const visible = !/(不可见|看不见|看不到|没?有找到|没?有出现|未找到|未出现|不存在|遮挡|需要滚动|已跳转|无法定位|不?再显示)/i.test(lower);
  return {
    visible,
    reason: t.slice(0, 200),
  };
}

// Run a vision pass over the active tab. Returns a VisionResult:
//   { ok, visible, reason, imageUsed }
// ok=false means vision is unavailable or the capture failed.
async function runVisionFallback({ bridge, llm, targetDesc, maxTries = 1 }) {
  try {
    const dataUrl = await bridge.capture();
    if (!dataUrl) return { ok: false, visible: false, reason: "capture failed (no activeTab permission)", imageUsed: false };
    const messages = [{ role: "user", content: buildVisionPrompt(targetDesc) }];
    const resp = await llm.generate(messages, { images: [dataUrl] });
    const answer = (resp.content || "").trim();
    const parsed = parseVisionAnswer(answer);
    return { ok: true, visible: parsed.visible, reason: parsed.reason, imageUsed: true };
  } catch (e) {
    return { ok: false, visible: false, reason: (e && e.message) || String(e), imageUsed: false };
  }
}

const vision = { buildVisionPrompt, parseVisionAnswer, runVisionFallback };
if (typeof module !== "undefined") {
  module.exports = vision;
} else {
  globalThis.VisionModule = vision;
}
