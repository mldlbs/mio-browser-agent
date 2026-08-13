// "本页可做" task suggestions. Pure functions over a snapshot: pattern-match
// the page's elements (roles/names/placeholders/values) into concrete task
// cards non-technical users can click instead of typing a goal. No LLM, no
// network — instant, free, unit-testable.

const SEARCH_HINTS = /(搜索|查找|查询|搜|search|query|find)/i;
const LOGIN_HINTS = /(登录|登陆|sign in|log in|login)/i;
const PASSWORD_HINTS = /(密码|口令|passwd|password)/i;
const NEXT_HINTS = /(下一页|下页|加载更多|加载全部|next|more|›|»|>>)/i;

// Dedupe by the goal text (rules may fire overlapping suggestions).
function dedupe(tasks) {
  const seen = new Set();
  return tasks.filter((t) => {
    if (seen.has(t.goal)) return false;
    seen.add(t.goal);
    return true;
  });
}

// A clean display name for an input/button, falling back to placeholder.
function displayName(e, fallback) {
  const n = (e.name || "").replace(/输入框\s*[（(]占位\s*[:：]?\s*.*?[）)]?\s*$/, "").trim();
  if (n && n !== "未命名输入框") return n;
  if (e.placeholder) return "「" + e.placeholder + "」";
  return fallback || "输入框";
}

function isTextInput(e) {
  return e.role === "textbox" || e.role === "combobox";
}

function isPassword(e) {
  if (e.inputType === "password") return true;
  if (e.inputType && e.inputType !== "text") return false;
  return PASSWORD_HINTS.test((e.name || "") + " " + (e.placeholder || ""));
}

// Filter out trivial utility fields (search-on-press links, submit-type buttons).
function hasSubmitButton(elems) {
  return elems.some((e) => {
    if (e.role !== "button") return false;
    if (e.inputType === "submit" || e.inputType === "button") return true;
    return /(提交|确定|搜索|登录|注册|send|submit|search|login|register|go)/i.test(e.name);
  });
}

// Detect a search form: a text input named like a search box plus a submit-like
// button. Returns the input or null.
function findSearchBox(elems) {
  const boxes = elems.filter((e) => isTextInput(e) && !isPassword(e));
  if (!boxes.length || !hasSubmitButton(elems)) return null;
  return boxes.find((e) => SEARCH_HINTS.test(e.name + " " + e.placeholder)) || null;
}

function findLoginFields(elems) {
  const pw = elems.filter((e) => isTextInput(e) && isPassword(e));
  if (!pw.length) return null;
  const users = elems.filter((e) => isTextInput(e) && !isPassword(e));
  return { user: users[0] || null, password: pw[0] };
}

function extractableTables(elems) {
  return elems.filter((e) => e.tag === "table" || e.role === "table" || e.role === "row" || e.role === "cell");
}

// Suggest one-click task cards for a page snapshot. Returns [{id,label,goal,hint}].
function suggestTasks(snapshot) {
  const elems = (snapshot && snapshot.elements) || [];
  if (!elems.length) return [];
  const tasks = [];

  const search = findSearchBox(elems);
  if (search) {
    tasks.push({
      id: "search",
      label: "搜索",
      goal: "在搜索框" + displayName(search, "") + "中输入「{keyword}」，点击提交按钮，提取第一条结果的要点。",
      hint: "自动定位搜索框并输入关键词",
    });
  }

  const login = findLoginFields(elems);
  if (login) {
    const who = LOGIN_HINTS.test(snapshot.title + " " + snapshot.url)
      ? "本页"
      : "登录页";
    tasks.push({
      id: "login",
      label: "登录",
      goal: "在" + who + "输入账号「{username}」和密码「{password}」，点击登录按钮，确认已进入账户页面。",
      hint: "账号密码来自模板填写",
    });
  }

  const table = extractableTables(elems);
  if (table.length) {
    tasks.push({
      id: "extract-table",
      label: "提取表格",
      goal: "提取本页所有表格的内容，整理成清晰的行列清单，用 memo 保存并总结要点。",
      hint: "把表格数据转成文本",
    });
  }

  const textInputs = elems.filter((e) => isTextInput(e) && !isPassword(e) && e.name !== "未命名输入框" && e.name);
  const multiField = textInputs.filter((e) => /(姓名|邮箱|电话|手机|地址|邮箱|标题|内容|日期|数量|备注|name|email|phone|addr|title|content)/i.test(e.name + " " + e.placeholder));
  if (multiField.length >= 2 && hasSubmitButton(elems)) {
    tasks.push({
      id: "form-fill",
      label: "填表提交",
      goal: "在本页表单中依次填写：{fields}。逐项填入后点击提交按钮，确认提交成功并提取回执信息。",
      hint: "自动定位表单字段逐个填写",
    });
  }

  const links = elems.filter((e) => e.role === "link" && e.href);
  if (links.length >= 8) {
    tasks.push({
      id: "extract-links",
      label: "提取链接",
      goal: "提取本页所有链接的标题与地址，用 memo 保存并汇总。",
      hint: "抓取页面上全部链接",
    });
  }

  const hasNext = elems.some((e) => NEXT_HINTS.test(e.name + " " + e.text + " " + e.placeholder));
  if (hasNext) {
    tasks.push({
      id: "crawl-pages",
      label: "翻页抓取",
      goal: "点击下一页/加载更多逐页浏览，提取每一页的内容，直到没有更多，最后用 memo 汇总全部内容。",
      hint: "遍历全部分页数据",
    });
  }

  // Always offer a generic extract (useful on almost every page), last.
  tasks.push({
    id: "extract-text",
    label: "提取文字",
    goal: "提取本页主要内容，整理成要点总结。",
    hint: "阅读并总结当前页面",
  });

  return dedupe(tasks).slice(0, 6);
}

if (typeof module !== "undefined") {
  module.exports = { suggestTasks, findSearchBox, findLoginFields, dedupe };
} else {
  globalThis.SuggestModule = { suggestTasks, findSearchBox, findLoginFields, dedupe };
}
