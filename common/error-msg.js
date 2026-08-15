// 失败提示人话化 — 把英文技术错误码翻译成小白能看懂的中文说明。
// 目标：新手看到"这个按钮没找到，我换个方式再试了一次"而不是 "ELEMENT_NOT_FOUND"。
// 纯函数，可单测。渲染层（sidepanel/recovery-events）负责组装成完整句子。

// 每个错误码：{ human, hint, advice }
//  - human: 一句话人话描述（直接给小白看）
//  - advice: 可选的下一步建议（小白能照做的动作）
const ERROR_MESSAGES = {
  ELEMENT_NOT_FOUND: {
    human: "没找到这个元素（按钮/输入框可能在别的位置）",
    advice: "我换个方式再试一次；如果还不行，可以刷新页面或换一个描述。",
  },
  STALE_ELEMENT: {
    human: "页面刚更新过，之前的按钮位置变了",
    advice: "我会重新看一下页面再试。",
  },
  FIELD_NOT_FOUND: {
    human: "没找到要填写的表单字段",
    advice: "我换个方式找；如果字段在弹窗里，先点开弹窗再试。",
  },
  SUBMIT_NOT_FOUND: {
    human: "没找到提交/发送按钮",
    advice: "我重新看一下页面找提交按钮；表单没填完时有些按钮是灰的。",
  },
  ELEMENT_DISABLED: {
    human: "这个按钮/输入框暂时是禁用状态",
    advice: "通常是页面还在加载或状态没同步，我等一下再试。",
  },
  TIMEOUT: {
    human: "页面响应超时，等太久了",
    advice: "我重新连接页面再试一次。",
  },
  WAIT_TIMEOUT: {
    human: "等待页面变化超时",
    advice: "目标内容迟迟没出现，我重新看一下页面。",
  },
  SCROLL_AT_END: {
    human: "页面已经滚到底/顶，没有更多内容了",
    advice: "我重新获取页面内容，看看有没有其他入口。",
  },
  CLICK_OUT_OF_VIEWPORT: {
    human: "点击的目标在屏幕外",
    advice: "我先把页面滚动到目标位置再点。",
  },
  CLICK_AT_UNVERIFIED: {
    human: "点了一下但页面没变化，可能没点中",
    advice: "我重新定位目标，换个方式再点。",
  },
  SEND_NOT_VERIFIED: {
    human: "发送后没确认是否成功",
    advice: "我检查一下消息/内容是否真的发出去了。",
  },
  NO_TOOL_CALLS: {
    human: "这一步没做出任何操作",
    advice: "我重新规划这一步骤再执行。",
  },
  TOOL_EXCEPTION: {
    human: "执行这一步时出了点小问题",
    advice: "我换个方式再试一次。",
  },
  RECOVERY_EXHAUSTED: {
    human: "我试了好几种办法都没成功",
    advice: "可以换个说法描述目标，或者刷新页面后再试。",
  },
  STEP_NOT_VERIFIED: {
    human: "这一步做完后没确认效果",
    advice: "我重新检查一下页面的实际情况。",
  },
  PAGE_RISK_STOP: {
    human: "为避免误操作，我停了下来",
    advice: "这一步看起来有风险（比如确认删除），需要你手动确认。",
  },
  CAPTCHA_REQUIRED: {
    human: "需要输入验证码",
    advice: "我尝试读取验证码图片；如果看不清，请手动输入。",
  },
  UNKNOWN: {
    human: "这一步出了问题",
    advice: "我重新试一下；如果还不行，换一种说法描述目标。",
  },
};

// 默认兜底文案（未知错误码）
const FALLBACK = ERROR_MESSAGES.UNKNOWN;

// 错误码 → 中文人话提示（{ human, advice }）。未知错误码兜底到通用文案。
function errorToHuman(code) {
  return ERROR_MESSAGES[code] || FALLBACK;
}

// 渲染成一句话，供日志行 / 计划面板使用：
//   "没找到这个元素（按钮/输入框可能在别的位置）→ 我换个方式再试一次"
function humanizeError(code, message) {
  const m = errorToHuman(code);
  let text = m.human;
  if (message && typeof message === "string") {
    const trimmed = message.trim().slice(0, 60);
    if (trimmed && !trimmed.includes("undefined")) text += `（${trimmed}）`;
  }
  return text;
}

// 完整人话描述（含下一步建议），供最终失败总结 / 计划面板展开详情用。
function humanizeErrorFull(code, message) {
  const m = errorToHuman(code);
  const parts = [m.human, m.advice];
  if (message && typeof message === "string") {
    const trimmed = message.trim().slice(0, 80);
    if (trimmed && !trimmed.includes("undefined")) parts.push("详情: " + trimmed);
  }
  return parts.join("\n");
}

// 把一条恢复事件流渲染成人话叙述（供 plan panel 展开详情）。
// events: [{kind:"error"|"attempt"|"outcome", ...}]
function humanizeRecoveryEvents(events) {
  if (!events || !events.length) return "";
  let code = "UNKNOWN";
  let message = "";
  const attempts = [];
  let outcome = null;
  for (const ev of events) {
    if (ev.kind === "error") { code = ev.code || "UNKNOWN"; message = ev.message || ""; }
    else if (ev.kind === "attempt") {
      const ok = ev.ok ? "✓" : "✗";
      const reason = ev.reason ? `（${ev.reason}）` : "";
      attempts.push(`  ${ok} ${attemptLabel(ev.action)}${reason}`);
    } else if (ev.kind === "outcome") outcome = ev.outcome;
  }
  const lines = ["❌ " + humanizeError(code, message)];
  if (attempts.length) lines.push("我试了这些办法:", ...attempts);
  if (outcome === "recovered") lines.push("结果: ✓ 我换了个方式，成功了");
  else if (outcome === "exhausted") lines.push("结果: ✗ " + ERROR_MESSAGES.RECOVERY_EXHAUSTED.human);
  return lines.join("\n");
}

function attemptLabel(action) {
  const labels = {
    retry_snapshot: "重新看了一遍页面",
    scroll_and_retry: "滚动页面后再找",
    wait_and_retry: "等一下再试",
    vision_locate: "用视觉识别目标位置",
    finish: "放弃这一步",
  };
  return labels[action] || action;
}

if (typeof module !== "undefined") {
  module.exports = { ERROR_MESSAGES, errorToHuman, humanizeError, humanizeErrorFull, humanizeRecoveryEvents, attemptLabel };
} else {
  globalThis.ErrorMsgModule = { ERROR_MESSAGES, errorToHuman, humanizeError, humanizeErrorFull, humanizeRecoveryEvents, attemptLabel };
}
