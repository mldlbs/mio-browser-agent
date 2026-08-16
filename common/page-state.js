// 页面状态（Browser State）分类 — 根据快照特征判断当前页面处于什么状态
// （LOGIN/SEARCH/FORM/TABLE/LIST/DETAIL/EMPTY/GENERIC），供执行层向 agent 注入
// "当前是什么页面、该找什么元素" 的聚焦提示，缩小搜索空间。
// 纯函数，可单测。零依赖。

const PAGE_STATES = {
  LOGIN: "login",
  SEARCH: "search",
  FORM: "form",
  TABLE: "table",
  LIST: "list",
  DETAIL: "detail",
  EMPTY: "empty",
  GENERIC: "generic",
};

// 从快照 elements 特征 + url/title 推断页面状态。返回 PAGE_STATES 之一。
function classifyPageState(snapshot) {
  const elems = (snapshot && snapshot.elements) || [];
  const url = ((snapshot && snapshot.url) || "").toLowerCase();
  const title = ((snapshot && snapshot.title) || "").toLowerCase();

  const textboxes = elems.filter((e) => e.role === "textbox" || e.role === "combobox");
  const passwords = textboxes.filter((e) => e.inputType === "password");
  const buttons = elems.filter((e) => e.role === "button");
  const submitLike = buttons.filter((e) => /(提交|登录|注册|搜索|send|submit|login|register|search|go)/i.test(e.name || ""));
  const tables = elems.filter((e) => e.tag === "table" || e.role === "table" || e.role === "row" || e.role === "cell");
  const nextLinks = elems.filter((e) => (e.role === "link" && /(下一页|下页|加载更多|next|more|›|»|>>)/i.test((e.name || "") + " " + (e.text || ""))));

  if (!elems.length) return PAGE_STATES.EMPTY;
  // 登录：有密码框（+ 用户名框）
  if (passwords.length) return PAGE_STATES.LOGIN;
  // 搜索：有搜索框 + 提交按钮
  const searchBox = textboxes.find((e) => /(搜索|查询|搜|search|query|find)/i.test((e.name || "") + " " + (e.placeholder || "")));
  if (searchBox && submitLike.length) return PAGE_STATES.SEARCH;
  // 表格：有表格元素
  if (tables.length) return PAGE_STATES.TABLE;
  // 表单：>=2 文本输入 + 提交按钮
  if (textboxes.length >= 2 && submitLike.length) return PAGE_STATES.FORM;
  // 列表：有翻页链接 或 url 含列表特征
  if (nextLinks.length || /(list|search|result|page|list)/i.test(url)) return PAGE_STATES.LIST;
  // 详情：url 含商品/详情路径，且页面内容相对单一
  if (/(\/item\/|\/dp\/|\/product\/|\/detail\/|\/goods\/)/.test(url)) return PAGE_STATES.DETAIL;
  return PAGE_STATES.GENERIC;
}

// 每种状态注入 agent 的聚焦提示：告诉模型当前是什么页面、优先找什么。
const STATE_FOCUS = {
  login: "当前页面是登录/账号页：优先找用户名输入框、密码输入框、验证码框和登录按钮。若表单有验证码，用 read_captcha 读取。",
  search: "当前页面是搜索页：在搜索框输入关键词后，优先点搜索/提交按钮。不要在结果页上重复搜索。",
  form: "当前页面是表单页：逐项定位并填写可见字段，确认后点提交。字段可能分布在弹窗/折叠区，必要时先展开。",
  table: "当前页面含表格：如需提取数据，用 extract_text 或按表格行/列索引读取，可配合 memo 保存。",
  list: "当前页面是列表/结果页：如需翻页提取，找「下一页/加载更多」链接逐页遍历；单条目标优先点商品/详情类链接（url 含 /item/ /dp/ /product/）而非店/栏目链接。",
  detail: "当前页面是详情页：主要信息（标题/价格/状态）通常在页面主体，用 extract_text 提取或从快照读取。",
  empty: "当前页面没有可交互元素：可能是页面未加载完或空页面。先用 wait 等待或 navigate 到目标页，不要在此页反复点击。",
  generic: "",
};

// 返回 agent 聚焦提示：state 为 null 时自动分类。
function pageFocusPrompt(snapshot, state) {
  const s = state || classifyPageState(snapshot);
  return STATE_FOCUS[s] || "";
}

if (typeof module !== "undefined") {
  module.exports = { PAGE_STATES, classifyPageState, STATE_FOCUS, pageFocusPrompt };
} else {
  globalThis.PageStateModule = { PAGE_STATES, classifyPageState, STATE_FOCUS, pageFocusPrompt };
}
