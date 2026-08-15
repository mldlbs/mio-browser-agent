// Task templates - one-click preset goals shown above the compose box.
// Pure data + small helpers (unit-testable). Local starter for the roadmap's
// "template marketplace": templates are just text, so users can extend or share.

const TEMPLATES = [
  {
    id: "search-extract",
    label: "搜索并提取",
    goal: "在 {site} 搜索「{keyword}」，打开第一条结果，提取页面主要内容并总结要点。",
    hint: "换掉 {site}/{keyword} 即可",
  },
  {
    id: "login-captcha",
    label: "登录并处理验证码",
    goal: "打开 {site} 登录页，输入账号密码，读取并填写验证码，点击登录，确认已进入账户首页。",
    hint: "需要设置里已配置账号/验证码读取能力",
  },
  {
    id: "cross-site",
    label: "跨站搬运",
    goal: "在 {source} 打开「{item}」，提取关键信息；再在 {target} 搜索相同内容并完成对比/录入。用 tab 工具在两个站点间切换，用 memo 保存提取的数据。",
    hint: "演示跨标签页 + 会话记忆",
  },
  {
    id: "compare",
    label: "比价",
    goal: "分别搜索「{product}」在 {siteA} 和 {siteB} 的价格，把两个价格与商品名称记录到 memo，最后总结哪家更便宜。",
    hint: "多站比价 + memo 汇总",
  },
  {
    id: "form-fill",
    label: "填表提交",
    goal: "在 {site} 的表单中填写：{fields}。逐项填入后点击提交按钮，确认提交成功并提取回执信息。",
    hint: "表单逐项填写 + 提交验证",
  },
  // 高频场景开箱模板（传播/分享友好：goal 只含占位符，无任何凭据/URL 记录）
  {
    id: "daily-signin",
    label: "每日签到",
    goal: "打开 {site}，找到签到入口并完成每日签到，确认签到成功，总结本次签到结果。",
    hint: "签到类站点通用（打卡/抽奖/任务中心）",
  },
  {
    id: "price-watch",
    label: "价格监控",
    goal: "打开 {site} 的商品「{product}」详情页，提取当前价格与库存状态，用 memo 保存本次价格，对比上一次记录并总结变化。",
    hint: "定期跑可做价格监控",
  },
  {
    id: "daily-report",
    label: "生成日报",
    goal: "打开 {site} 的工作台/报表页，提取今天的数据指标，整理成简明日报要点。",
    hint: "日报/数据汇总类",
  },
  {
    id: "course-snatch",
    label: "抢课报名",
    goal: "打开 {site} 的选课/报名页，找到课程「{course}」，点击报名/抢课按钮，确认报名成功并记录结果。",
    hint: "选课/抢名额/秒杀类",
  },
  {
    id: "read-article",
    label: "读文章存笔记",
    goal: "打开 {site} 的文章「{article}」，提取正文，整理成要点，用 memo 保存。",
    hint: "长文阅读 + 笔记",
  },
];

function applyTemplate(tpl, values) {
  let goal = tpl.goal;
  const v = values || {};
  for (const key of Object.keys(v)) {
    goal = goal.split("{" + key + "}").join(String(v[key] || ""));
  }
  return goal;
}

function findTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

// Extract unique {placeholder} keys from a goal text (order preserved).
function extractPlaceholders(goal) {
  return [...new Set((goal.match(/\{(\w+)\}/g) || []).map((s) => s.slice(1, -1)))];
}

// Custom templates persisted per-user (storage.local). Built-in templates are
// always shown first; custom ones (added from history "存为模板") follow.
const CUSTOM_KEY = "mioCustomTemplates";

async function getCustomTemplates() {
  if (!globalThis.chrome || !chrome.storage) return [];
  const raw = await chrome.storage.local.get(CUSTOM_KEY);
  const list = raw && raw[CUSTOM_KEY];
  return Array.isArray(list) ? list : [];
}

async function getTemplates() {
  const custom = await getCustomTemplates();
  return TEMPLATES.concat(custom.map((t) => Object.assign({}, t, { custom: true })));
}

async function addCustomTemplate(tpl) {
  const list = await getCustomTemplates();
  const goal = (tpl && tpl.goal) || "";
  if (list.some((t) => t.goal === goal)) return null;
  const custom = {
    id: "custom-" + Date.now().toString(36),
    label: (tpl && tpl.label) || "自定义模板",
    goal,
    hint: (tpl && tpl.hint) || "自定义模板",
  };
  const next = list.concat(custom).slice(-50);
  await chrome.storage.local.set({ [CUSTOM_KEY]: next });
  return custom;
}

// Build a portable, shareable template payload. Deliberately ONLY carries the
// goal text (with its {placeholders}), label and hint — never credentials, URLs
// of completed runs, or session state. Someone pasting this in gets a template
// they can fill and run, not any private data.
function buildShareTemplate(tpl) {
  return {
    app: "mio",
    version: 1,
    type: "template",
    label: (tpl && tpl.label) || "我的模板",
    goal: (tpl && tpl.goal) || "",
    hint: (tpl && tpl.hint) || "",
    placeholders: extractPlaceholders((tpl && tpl.goal) || ""),
  };
}

// Parse a share payload (JSON string or already-parsed object) into a template
// ready for addCustomTemplate. Throws on invalid/malicious-looking payloads so
// the caller can show a friendly error instead of importing garbage.
function parseShareTemplate(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); }
    catch (_) { throw new Error("分享内容不是有效的 JSON"); }
  }
  if (!obj || typeof obj !== "object") throw new Error("分享内容无效");
  if (obj.type && obj.type !== "template") throw new Error("这不是 mio 模板分享（type 应为 template）");
  const goal = String(obj.goal || "").trim();
  if (!goal) throw new Error("模板缺少 goal 文本");
  return {
    label: String(obj.label || "我的模板").slice(0, 40),
    goal: goal.slice(0, 2000),
    hint: String(obj.hint || "分享来的模板").slice(0, 120),
  };
}

if (typeof module !== "undefined") {
  module.exports = { TEMPLATES, applyTemplate, findTemplateById, extractPlaceholders, getCustomTemplates, getTemplates, addCustomTemplate, buildShareTemplate, parseShareTemplate };
} else {
  globalThis.TemplatesModule = { TEMPLATES, applyTemplate, findTemplateById, extractPlaceholders, getCustomTemplates, getTemplates, addCustomTemplate, buildShareTemplate, parseShareTemplate };
}
