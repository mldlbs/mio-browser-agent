// 工具调用人话化 — 把底层工具调用翻译成小白能看懂的中文描述。
// 纯函数，可单测。渲染层用它对执行日志做人性化展示。

const TOOL_LABELS = {
  click: "点击",
  click_at: "点击",
  type: "输入",
  paste: "粘贴",
  scroll: "滚动页面",
  navigate: "打开网页",
  extract_text: "读取文字",
  extract_table: "提取表格",
  wait: "等待",
  tab: "切换标签页",
  memo: "记录笔记",
  read_captcha: "识别验证码",
  form_fill: "填写表单",
  find_by_vision: "视觉定位",
  finish: "完成",
};

// 工具名 → 中文动作词。未知工具回退原名。
function toolNameToChinese(name) {
  return TOOL_LABELS[name] || name || "操作";
}

// 用参数拼一个更具体的描述（尽力而为，参数结构各工具不同）。
// 例如：type {text:"hello"} → 「在输入框输入 hello」
function describeToolCall(name, args) {
  const a = args || {};
  const base = toolNameToChinese(name);
  if (name === "type" || name === "paste") {
    const text = (a.text || "").slice(0, 40);
    if (text) return base + "：" + text;
  }
  if (name === "navigate") {
    const url = (a.url || "").slice(0, 60);
    if (url) return "打开网页：" + url;
  }
  if (name === "click") {
    if (a.field) return "点击字段：" + a.field;
    if (a.index != null) return base + "页面元素";
  }
  if (name === "scroll") {
    return (a.delta && a.delta > 0 ? "向下滚动页面" : "向上滚动页面");
  }
  if (name === "tab") {
    if (a.mode === "open" && a.url) return "新标签页打开：" + (a.url || "").slice(0, 40);
    if (a.mode === "switch") return "切换到标签页 " + a.index;
    if (a.mode === "list") return "查看标签页列表";
    if (a.mode === "close") return "关闭标签页 " + a.index;
  }
  if (name === "memo") {
    if (a.mode === "set") return "记录「" + (a.key || "") + "」";
    if (a.mode === "get") return "读取笔记「" + (a.key || "") + "」";
    if (a.mode === "list") return "查看笔记";
  }
  if (name === "wait") {
    if (a.selector) return "等待页面出现：" + a.selector;
    if (a.ms) return "等待 " + a.ms + " 毫秒";
  }
  if (name === "form_fill") {
    const keys = Object.keys(a.fields || {});
    return "填写表单（" + keys.length + " 项）";
  }
  if (name === "read_captcha") return "读取并识别验证码";
  if (name === "find_by_vision") {
    return "视觉定位：" + (a.target || "").slice(0, 40);
  }
  if (name === "click_at") {
    if (a.x != null && a.y != null) return "点击坐标 (" + a.x + ", " + a.y + ")";
  }
  if (name === "extract_text") return "读取页面文字";
  return base;
}

if (typeof module !== "undefined") {
  module.exports = { TOOL_LABELS, toolNameToChinese, describeToolCall };
} else {
  globalThis.ToolLabelsModule = { TOOL_LABELS, toolNameToChinese, describeToolCall };
}
