// Field-key → snapshot/DOM element matching for form filling. Pure, DOM-free,
// so it unit-tests in Node. El is a normalized shape { name, placeholder, role, value }.
const FIELD_SYNONYMS = {
  username: ["用户名", "账号", "用户", "登录名", "账户", "昵称"],
  email: ["邮箱", "电子邮件", "邮件", "电子邮箱"],
  password: ["密码", "口令", "登录密码", "pwd"],
  confirm: ["确认密码", "重复密码", "再次输入密码"],
  phone: ["手机", "手机号", "电话", "电话号码", "联系方式"],
  city: ["城市", "地区", "所在城市"],
  search: ["搜索", "查询", "搜", "关键词"],
  name: ["姓名", "名字", "真实姓名"],
  code: ["验证码", "验证", "短信验证码"],
  company: ["公司", "企业", "单位"],
  agree: ["同意", "勾选", "条款"],
};
const ROLE_FIELDS = new Set(["textbox", "combobox", "checkbox", "radio"]);

function normalizeText(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "");
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ASCII word keys must match at token boundaries, else short keys like "name",
// "code", or "search" substring-collide with identifiers like "username-input",
// "area_code", or "research". CJK/mixed keys keep plain substring matching.
function isAsciiWordKey(key) {
  return /^[a-z0-9]+$/.test(key);
}

function tokenBoundaryExact(key, name, ph) {
  const re = new RegExp("(^|[^a-z0-9_])" + escapeRegExp(key) + "($|[^a-z0-9_])");
  return re.test(name) || re.test(ph);
}

function matchField(fieldKey, el) {
  if (!fieldKey || !el) return { quality: "none", fieldKey };
  if (!ROLE_FIELDS.has(el.role)) return { quality: "none", fieldKey };
  const key = normalizeText(fieldKey);
  const name = normalizeText(el.name);
  const ph = normalizeText(el.placeholder);
  if (key) {
    const exact = isAsciiWordKey(key) ? tokenBoundaryExact(key, name, ph) : (name.includes(key) || ph.includes(key));
    if (exact) return { quality: "exact", fieldKey };
  }
  const syns = FIELD_SYNONYMS[fieldKey] || [];
  for (const s of syns) {
    const n = normalizeText(s);
    if (name.includes(n) || ph.includes(n)) return { quality: "synonym", fieldKey };
  }
  return { quality: "none", fieldKey };
}

if (typeof module !== "undefined") {
  module.exports = { FIELD_SYNONYMS, matchField };
} else {
  globalThis.FieldsModule = { FIELD_SYNONYMS, matchField };
}
