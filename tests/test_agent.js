const protocol = require("../common/protocol.js");
const snapshotMod = require("../content/snapshot.js");
const contentExecMod = require("../content/executor.js");
const locatorMod = require("../content/locator.js");
const shadowMod = require("../content/shadow.js");
const storage = require("../common/storage.js");
const historyMod = require("../common/history.js");
const templatesMod = require("../common/templates.js");
const suggestMod = require("../common/suggest.js");
const taskMemoryMod = require("../common/task-memory.js");
const schedulerMod = require("../common/scheduler.js");
const errorMsgMod = require("../common/error-msg.js");
const toolLabelsMod = require("../common/tool-labels.js");
const pageStateMod = require("../common/page-state.js");
const adapterMod = require("../llm/adapter.js");
global.registerProvider = adapterMod.registerProvider;
global.normalizeCompletion = adapterMod.normalizeCompletion;
require("../llm/openai.js");
require("../llm/anthropic.js");
const registryMod = require("../tools/registry.js");
global.registerTool = registryMod.registerTool;
require("../tools/click.js");
require("../tools/type.js");
require("../tools/scroll.js");
require("../tools/wait.js");
require("../tools/navigate.js");
require("../tools/extract_text.js");
require("../tools/paste.js");
require("../tools/read_captcha.js");
require("../tools/tab.js");
require("../tools/memo.js");
require("../tools/click_at.js");
require("../tools/find_by_vision.js");
require("../tools/form_fill.js");
const plannerMod = require("../sidepanel/planner.js");
const memoryMod = require("../sidepanel/memory.js");
const notesMod = require("../sidepanel/notes.js");
const executorMod = require("../sidepanel/executor.js");
global.snapshotToLines = protocol.snapshotToLines;
global.snapshotStats = protocol.snapshotStats;
global.planner = plannerMod;
global.executor = executorMod;
global.createMemory = memoryMod.createMemory;
global.NotesModule = notesMod;
global.getTool = registryMod.getTool;
global.getToolsSchema = registryMod.getToolsSchema;
global.createAdapter = (s) => adapterMod.createAdapter(s);
const runtimeMod = require("../sidepanel/agent-runtime.js");

// Stub DOM element constructors so setNativeValue can run in Node.
// executor.js reads HTML*Element.prototype's "value" descriptor and calls its
// setter with the mock element as `this`; the setter writes a real own property.
function stubValueSetter(name) {
  global[name] = function () {};
  Object.defineProperty(global[name].prototype, "value", {
    configurable: true,
    set(v) { Object.defineProperty(this, "value", { value: v, configurable: true, writable: true }); },
    get() { return this._v; },
  });
}
["HTMLTextAreaElement", "HTMLInputElement", "HTMLSelectElement"].forEach(stubValueSetter);


function mockLlm(script) {
  let i = 0;
  return { generate: async () => (script[i] ? script[i++]() : { content: "", toolCalls: [] }) };
}
function makeToolCall(name, args) { return { id: "call_" + Math.random().toString(36).slice(2, 8), name, args }; }

let failures = 0;
function assert(cond, name) {
  if (cond) console.log("PASS: " + name);
  else { failures++; console.log("FAIL: " + name); }
}
function assertEq(got, want, name) {
  assert(got === want, `${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

(async () => {
  // ── protocol ──
  assertEq(protocol.MSG.SNAPSHOT_REQUEST, "SNAPSHOT_REQUEST", "MSG constant");
  const m = protocol.make(protocol.MSG.ACTION_EXECUTE, { taskId: 1, action: {} });
  assertEq(m.type, protocol.MSG.ACTION_EXECUTE, "make sets type");
  assertEq(m.payload.taskId, 1, "make sets payload");

  // ── form-fill field matching (common/fields.js) ──
  const fieldsMod = require("../common/fields.js");
  const ff = fieldsMod.matchField;
  assertEq(ff("username", { name: "用户名", placeholder: "", role: "textbox" }).quality, "synonym", "matchField synonym: 用户名 hits username");
  assertEq(ff("username", { name: "", placeholder: "请输入用户名", role: "textbox" }).quality, "synonym", "matchField synonym via placeholder");
  assertEq(ff("username", { name: "username-input", placeholder: "", role: "textbox" }).quality, "exact", "matchField exact: ascii key substring in name");
  assertEq(ff("username", { name: "Email", placeholder: "", role: "textbox" }).quality, "none", "matchField: username does not match email");
  assertEq(ff("password", { name: "密码", placeholder: "", role: "textbox" }).quality, "synonym", "matchField synonym: 密码 hits password");
  assertEq(ff("email", { name: "邮箱", placeholder: "", role: "textbox" }).quality, "synonym", "matchField synonym: 邮箱 hits email");
  assertEq(ff("city", { name: "城市", placeholder: "", role: "combobox" }).quality, "synonym", "matchField synonym: 城市 hits city");
  assertEq(ff("phone", { name: "手机号", placeholder: "", role: "textbox" }).quality, "synonym", "matchField synonym: 手机号 hits phone");
  assertEq(ff("zzzz", { name: "用户名", placeholder: "", role: "textbox" }).quality, "none", "matchField unknown key returns none");
  assertEq(ff("username", { name: "", placeholder: "", role: "button" }).quality, "none", "matchField ignores non-field roles");
  assertEq(ff("username", null).quality, "none", "matchField handles null element");
  assert(fieldsMod.FIELD_SYNONYMS.password.includes("密码"), "FIELD_SYNONYMS covers password");
  assert(fieldsMod.FIELD_SYNONYMS.email.includes("邮箱"), "FIELD_SYNONYMS covers email");
  assertEq(ff("name", { name: "username-input", placeholder: "", role: "textbox" }).quality, "none", "matchField: name does not substring-collide with username");
  assertEq(ff("name", { name: "name-input", placeholder: "", role: "textbox" }).quality, "exact", "matchField: name matches at token boundary");
  assertEq(ff("code", { name: "area_code", placeholder: "", role: "textbox" }).quality, "none", "matchField: code does not match area_code");
  assertEq(ff("code", { name: "code", placeholder: "", role: "textbox" }).quality, "exact", "matchField: code matches exact token");
  assertEq(ff("code", { name: "验证码", placeholder: "", role: "textbox" }).quality, "synonym", "matchField: code hits 验证码 via synonym table");
  assertEq(ff("username", { name: "", placeholder: "", role: "textbox" }).quality, "none", "matchField: empty name+placeholder no match");
  assertEq(ff("__proto__", { name: "用户名", placeholder: "", role: "textbox" }).quality, "none", "matchField: prototype-inherited key does not crash");
  assertEq(ff("constructor", { name: "用户名", placeholder: "", role: "textbox" }).quality, "none", "matchField: constructor key does not crash");
  assertEq(ff("search", { name: "商品搜罗", placeholder: "", role: "textbox" }).quality, "none", "matchField: single-char CJK synonym does not hit compound words");
  assertEq(ff("search", { name: "搜索框", placeholder: "", role: "textbox" }).quality, "synonym", "matchField: single-char CJK synonym still matches real labels");
  assert(ff("confirm", { name: "确认密码", placeholder: "", role: "textbox" }).synonymLen > ff("password", { name: "确认密码", placeholder: "", role: "textbox" }).synonymLen, "matchField: longer synonym is more specific for 确认密码");

  const snap = { url: "https://x.com", title: "X", elements: [
    { index: 0, role: "button", name: "登录", value: "", boundingBox: { x: 1, y: 2, w: 3, h: 4 } },
    { index: 1, role: "textbox", name: "搜索", value: "abc", boundingBox: null },
  ]};
  const lines = protocol.snapshotToLines(snap);
  assert(lines.includes('[0] button "登录"'), "snapshotToLines role+name");
  assert(lines.includes('value="abc"'), "snapshotToLines value");
   assert(protocol.snapshotToLines(null).includes("no snapshot"), "snapshotToLines null");

  // href destination rendered in link lines
  const snapHref = { url: "https://x.com", title: "X", elements: [
    { index: 0, role: "link", name: "商品卡", href: "/item/12345.html", boundingBox: null },
    { index: 1, role: "link", name: "店铺", href: "/store/999", boundingBox: null },
    { index: 2, role: "link", name: "无链接", boundingBox: null },
  ]};
  const hrefLines = protocol.snapshotToLines(snapHref);
  assert(hrefLines.includes('[0] link "商品卡" → /item/12345.html'), "snapshotToLines renders link href destination");
  assert(hrefLines.includes('[1] link "店铺" → /store/999'), "snapshotToLines renders shop href");
  assert(hrefLines.includes('[2] link "无链接"') && !hrefLines.includes('[2] link "无链接" →'), "snapshotToLines omits dest when no href");
  // Scene Graph 轻量版：group 语义容器显示在快照行，帮助关联同组元素
  const snapGroup = { url: "https://x.com", title: "X", elements: [
    { index: 0, role: "textbox", name: "用户名", group: "form#login", boundingBox: null },
    { index: 1, role: "textbox", name: "密码", group: "form#login", boundingBox: null },
    { index: 2, role: "button", name: "登录", group: "form#login", boundingBox: null },
    { index: 3, role: "link", name: "无容器", group: "", boundingBox: null },
  ]};
  const groupLines = protocol.snapshotToLines(snapGroup);
  assert(groupLines.includes('"用户名" <form#login>'), "snapshotToLines renders semantic group (got: " + groupLines.split("\n")[0] + ")");
  assert(groupLines.includes('"登录" <form#login>'), "snapshotToLines groups sibling form controls");
  assert(!groupLines.includes('"无容器" <'), "snapshotToLines omits group when empty");

  // ── hasInteractiveDescendant: nested anchors must not disqualify a card ──
  function mockEl(sel, children = []) {
    return {
      matches: (selector) => String(selector).split(",").includes(sel),
      children: Array.from(children),
    };
  }
  // card with a nested shop anchor (marketplace product card): direct child is a div, nested <a> is 2 levels down
  const innerAnchor = mockEl("a[href]");
  const cardInnerDiv = mockEl("div", [innerAnchor]);
  const card = mockEl("a[href]", [cardInnerDiv]);
  assert(!snapshotMod.hasInteractiveDescendant(card), "nested anchor inside card does not disqualify the card");
  // a container whose DIRECT child is interactive (e.g. div>button) still disqualifies
  const btn = mockEl("button");
  const container = mockEl("div", [btn]);
  assert(snapshotMod.hasInteractiveDescendant(container), "direct interactive child still disqualifies container");

  // ── icon-only buttons get a usable name (not a bare "div") ──
  const iconBtnEl = {
    tagName: "DIV",
    getAttribute: (a) => (a === "onclick" ? "return 0" : a === "class" ? "ds-icon-btn send" : null),
    querySelector: (s) => (s === "svg" ? null : null),
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.computeRole(iconBtnEl), "button", "clickable div maps to button role");
  assert(snapshotMod.computeAccessibleName(iconBtnEl).includes("send"), "icon button named from class");
  const plainDiv = {
    tagName: "DIV",
    getAttribute: () => null,
    querySelector: () => null,
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.computeRole(plainDiv), "generic", "plain div stays generic");
  assertEq(snapshotMod.computeAccessibleName(plainDiv), "div", "plain div name unchanged");
  const svgIconBtn = {
    tagName: "BUTTON",
    getAttribute: (a) => (a === "onclick" ? null : null),
    querySelector: (s) => (s === "svg" ? { querySelector: (t) => (t === "title" ? { textContent: "发送" } : null), getAttribute: () => null } : null),
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.computeAccessibleName(svgIconBtn), "发送", "icon button named from svg title");

  // ── captcha images (verification codes) get a usable name ──
  const captchaImg = {
    tagName: "IMG",
    getAttribute: (a) => (a === "class" ? "captcha-img" : a === "alt" ? null : null),
    querySelector: () => null,
    innerText: "",
    textContent: "",
  };
  assert(snapshotMod.computeAccessibleName(captchaImg).includes("验证码"), "captcha img named from class hint");
  const captchaCanvas = {
    tagName: "CANVAS",
    getAttribute: (a) => (a === "class" ? "verify-code" : null),
    querySelector: () => null,
    innerText: "",
    textContent: "",
  };
  assert(snapshotMod.computeAccessibleName(captchaCanvas).includes("验证码"), "captcha canvas named from class hint");
  const plainImg = {
    tagName: "IMG",
    getAttribute: () => null,
    querySelector: () => null,
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.computeAccessibleName(plainImg), "图片", "plain img falls back to 图片");

  // ── shadow root 内 label 关联：associatedLabel/labelledBy 从 getRootNode 查询 ──
  global.CSS = global.CSS || { escape: (s) => s };
  const shadowLabel = { textContent: "shadow用户名" };
  const shadowRootForLabel = {
    getElementById: (id) => (id === "sf2-username" ? shadowLabel : null),
    querySelector: (sel) => (sel === 'label[for="sf2-username"]' ? shadowLabel : null),
  };
  const shadowInputForLabel = {
    tagName: "INPUT",
    id: "sf2-username",
    getAttribute: (a) => (a === "id" ? "sf2-username" : a === "aria-label" ? null : a === "placeholder" ? "shadow用户名" : null),
    getRootNode: () => shadowRootForLabel,
    closest: () => null,
    isContentEditable: false,
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.associatedLabel(shadowInputForLabel), "shadow用户名", "associatedLabel finds label inside shadow root");
  assertEq(snapshotMod.computeAccessibleName(shadowInputForLabel), "shadow用户名", "computeAccessibleName uses shadow root label (not placeholder fallback)");

  // labelledBy inside shadow root: aria-labelledby resolves within the element's own root
  const shadowLabelBy = { textContent: "shadow昵称" };
  const shadowRootForLabelledBy = {
    getElementById: (id) => (id === "sf-nick" ? shadowLabelBy : null),
  };
  const shadowInputForLabelledBy = {
    tagName: "INPUT",
    getAttribute: (a) => (a === "aria-labelledby" ? "sf-nick" : null),
    getRootNode: () => shadowRootForLabelledBy,
    closest: () => null,
    isContentEditable: false,
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.labelledBy(shadowInputForLabelledBy), "shadow昵称", "labelledBy resolves aria-labelledby inside shadow root");
  assertEq(snapshotMod.computeAccessibleName(shadowInputForLabelledBy), "shadow昵称", "computeAccessibleName prefers labelledby inside shadow root");

  // getRootNode 缺失时降级到 document（document 上仍有该 label）
  const savedLegacyDoc = global.document;
  global.document = {
    querySelector: (sel) => (sel === 'label[for="legacy-user"]' ? { textContent: "旧文档用户名" } : null),
  };
  const legacyInput = {
    tagName: "INPUT",
    id: "legacy-user",
    getAttribute: (a) => (a === "id" ? "legacy-user" : null),
    closest: () => null,
    isContentEditable: false,
    innerText: "",
    textContent: "",
  };
  assertEq(snapshotMod.associatedLabel(legacyInput), "旧文档用户名", "associatedLabel falls back to document when getRootNode missing");
  global.document = savedLegacyDoc;

  // ── annotatePositions: icon buttons near a textbox get a position hint ──
  const posElems = [
    { index: 0, role: "textbox", name: "输入框(占位: 给 DeepSeek 发送消息 )", boundingBox: { x: 0, y: 100, w: 300, h: 40 } },
    { index: 1, role: "button", name: "图标按钮", boundingBox: { x: 320, y: 108, w: 24, h: 24 } },
    { index: 2, role: "button", name: "发送", boundingBox: { x: 400, y: 0, w: 10, h: 10 } },
    { index: 3, role: "button", name: "div", boundingBox: { x: 330, y: 108, w: 24, h: 24 } },
  ];
  snapshotMod.annotatePositions(posElems);
  assert(posElems[1].name.includes("输入框右"), "icon button near textbox gets right hint");
  assert(posElems[2].name === "发送", "named button keeps its own name");
  assert(posElems[3].name.includes("输入框右"), "bare-div button also gets position hint");

  // ── extractPageText: pulls readable text, strips noise, caps length ──
  const savedDoc = global.document;
  const savedLoc = global.location;
  global.document = {
    body: { innerText: "第一章 主角出场。\n\n正文内容。", cloneNode: () => ({ querySelectorAll: () => [], innerText: "第一章 主角出场。\n\n正文内容。" }) },
    querySelector: () => null,
  };
  global.location = { href: "https://novel.example/ch1" };
  const ext = contentExecMod.extractPageText(100);
  global.document = savedDoc;
  global.location = savedLoc;
  assert(ext.ok, "extractPageText returns ok");
  assert(ext.value.text.includes("第一章"), "extractPageText includes body text");
  assert(ext.value.url === "https://novel.example/ch1", "extractPageText includes url");
  assert(ext.value.text.length <= 120, "extractPageText caps length");

  // ── extractPageText: appends text from open shadow roots via textContent ──
  const shadowRootMock2 = {
    mode: "open",
    isShadowRoot: true,
    textContent: "shadow 内按钮：确认提交",
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const shadowHost2 = { nodeType: 1, shadowRoot: shadowRootMock2, querySelectorAll: () => [] };
  global.document = {
    title: "shadow 页面",
    body: { innerText: "正文内容", cloneNode: () => ({ querySelectorAll: () => [], innerText: "正文内容" }) },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === "iframe" ? [] : sel === "*" ? [shadowHost2] : []),
  };
  global.location = { href: "https://novel.example/shadow" };
  const extShadow = contentExecMod.extractPageText(1000);
  global.document = savedDoc;
  global.location = savedLoc;
  assert(extShadow.ok, "extractPageText with shadow root returns ok");
  assert(extShadow.value.text.includes("[shadow]"), "extractPageText appends [shadow] section");
  assert(extShadow.value.text.includes("确认提交"), "extractPageText includes shadow root textContent");

  // ── pasteText: writes into contenteditable and textarea ──
  let editableText = "";
  const editable = {
    isContentEditable: true,
    textContent: "",
    focus: () => {},
    dispatchEvent: () => {},
  };
  const pe = await contentExecMod.pasteText(editable, "正文第一段", false);
  assert(pe.ok && editable.textContent === "正文第一段", "pasteText writes into contenteditable");
  const clearEd = await contentExecMod.pasteText(editable, "覆盖", true);
  assert(clearEd.ok && editable.textContent === "覆盖", "pasteText clear replaces contenteditable");
  const area = {
    tagName: "TEXTAREA",
    value: "",
    focus: () => {},
    dispatchEvent: () => {},
  };
  const pa = await contentExecMod.pasteText(area, "段落A\n段落B", false);
  assert(pa.ok && area.value === "段落A\n段落B", "pasteText writes into textarea with newlines");

  // ── resolveFrameDoc: descends same-origin iframes by index ──
  const iframeDoc = { querySelectorAll: () => [] };
  const iframeEl = { contentDocument: iframeDoc };
  const rootDoc = { querySelectorAll: (sel) => (sel === "iframe" ? [iframeEl] : []) };
  const savedG = global.document;
  global.document = rootDoc;
  const frameResolved = locatorMod.resolveFrameDoc([0]);
  assert(frameResolved === iframeDoc, "resolveFrameDoc descends into same-origin iframe by index");
  assert(locatorMod.resolveFrameDoc([]) === rootDoc, "resolveFrameDoc empty path stays on root");
  global.document = savedG;

  // ── Shadow DOM: cssPath builds selector, locator resolves shadow roots ──
  global.CSS = global.CSS || { escape: (s) => s };
  global.XPathResult = global.XPathResult || { FIRST_ORDERED_NODE_TYPE: 9 };
  const shLeaf = { nodeType: 1, tagName: "BUTTON", id: "shadow-btn", parentNode: null };
  assertEq(snapshotMod.buildCssPath(shLeaf), "#shadow-btn", "buildCssPath prefers id");
  const sh0 = { nodeType: 1, tagName: "DIV", id: "", parentNode: null, children: [] };
  const sh1 = { nodeType: 1, tagName: "DIV", id: "", parentNode: sh0, children: [] };
  const sh2 = { nodeType: 1, tagName: "BUTTON", id: "", parentNode: sh1, children: [] };
  sh0.children = [sh1]; sh1.children = [sh2];
  assertEq(snapshotMod.buildCssPath(sh2), "div > div > button", "buildCssPath chains tags");
  const shadowRootMock = { mode: "open", isShadowRoot: true, querySelector: () => null };
  const shadowHost = { nodeType: 1, shadowRoot: shadowRootMock };
  const cssDoc = { querySelector: (sel) => (sel === "#host" ? shadowHost : null) };
  const resolved = locatorMod.resolveShadowPath(cssDoc, ["#host"]);
  assert(resolved === shadowRootMock, "resolveShadowPath descends into open shadow root");
  assert(locatorMod.resolveShadowPath(cssDoc, []) === cssDoc, "resolveShadowPath empty path stays on container");
  const shadowBtn = { tagName: "BUTTON" };
  const sroot = { querySelector: (sel) => (sel === "#shadow-btn" ? shadowBtn : null) };
  assert(locatorMod.findByCssPath("#shadow-btn", sroot) === shadowBtn, "findByCssPath works on ShadowRoot-like container");
  assert(locatorMod.findByCssPath("", sroot) === null, "findByCssPath empty returns null");
  assert(locatorMod.findByCssPath("#nope", { querySelector: () => null }) === null, "findByCssPath miss returns null");
  assert(locatorMod.findByXPath("//x", {}) === null, "findByXPath guards non-evaluate containers");

  // ── shadow.js 统一遍历工具 ──
  const deepRoot = { mode: "open", querySelectorAll: () => [], querySelector: () => null };
  const innerHost = { nodeType: 1, shadowRoot: deepRoot, querySelectorAll: () => [] };
  const outerHost = { nodeType: 1, shadowRoot: { mode: "open", querySelectorAll: () => [innerHost], querySelector: () => null }, querySelectorAll: () => [] };
  const mockDoc = { querySelectorAll: (sel) => (sel === "*" ? [outerHost] : []), querySelector: () => null };
  const collected = shadowMod.collectOpenShadowRoots(mockDoc);
  assert(collected.includes(deepRoot), "collectOpenShadowRoots descends nested open shadow roots", JSON.stringify(collected.map((r) => r.mode)));
  const visitedRoots = [];
  shadowMod.walkShadowTree(mockDoc, (r) => visitedRoots.push(r));
  assert(visitedRoots.length === 3, "walkShadowTree visits doc + all open roots", String(visitedRoots.length));
  const foundEl = { tagName: "INPUT" };
  const srootWithInput = { mode: "open", querySelectorAll: () => [], querySelector: (sel) => (sel === "input" ? foundEl : null) };
  const mockDoc2 = { querySelectorAll: (sel) => (sel === "*" ? [{ nodeType: 1, shadowRoot: srootWithInput }] : []), querySelector: (sel) => (sel === "input" ? null : null) };
  assert(shadowMod.findElementInShadows("input", mockDoc2) === foundEl, "findElementInShadows finds element inside open shadow root");

  // ── shadowPath 现在用 cssPath（宿主链），不再是 XPath ──
  const cssHost0 = { nodeType: 1, tagName: "DIV", id: "hostA", parentNode: null };
  const cssHost1 = { nodeType: 1, tagName: "DIV", id: "hostB", parentNode: null };
  assertEq(snapshotMod.buildCssPath(cssHost0), "#hostA", "shadow host cssPath uses id");
  assertEq(snapshotMod.buildCssPath(cssHost1), "#hostB", "nested shadow host cssPath uses id");

  // ── resolveShadowPath 用 cssPath 下钻，ShadowRoot 上无 evaluate 也能穿透嵌套 ──
  const innerBtn = { tagName: "BUTTON" };
  const innerRoot2 = { mode: "open", querySelector: (sel) => (sel === "#btn" ? innerBtn : null) };
  const innerHost2 = { nodeType: 1, shadowRoot: innerRoot2, querySelector: () => null };
  const nestOuterRoot = { mode: "open", querySelector: (sel) => (sel === "#inner" ? innerHost2 : null) };
  const nestOuterHost = { nodeType: 1, shadowRoot: nestOuterRoot };
  const docForNested = { querySelector: (sel) => (sel === "#outer" ? nestOuterHost : null) };
  const nestedResolved = locatorMod.resolveShadowPath(docForNested, ["#outer", "#inner"]);
  assert(nestedResolved === innerRoot2, "resolveShadowPath descends two shadow levels via cssPath", String(!!nestedResolved));

  // resolveShadowPath 失败路径：closed root / 宿主缺失 / 非 querySelector 容器
  const closedHost = { shadowRoot: { mode: "closed" } };
  const docClosed = { querySelector: () => closedHost };
  assert(locatorMod.resolveShadowPath(docClosed, ["#host"]) === null, "resolveShadowPath rejects closed shadow root", String(!!locatorMod.resolveShadowPath(docClosed, ["#host"])));
  const docMiss = { querySelector: () => null };
  assert(locatorMod.resolveShadowPath(docMiss, ["#nope"]) === null, "resolveShadowPath null when host missing", String(!!locatorMod.resolveShadowPath(docMiss, ["#nope"])));
  assert(locatorMod.resolveShadowPath({}, ["#host"]) === null, "resolveShadowPath null on non-querySelector container", String(!!locatorMod.resolveShadowPath({}, ["#host"])));
  assert(locatorMod.resolveShadowPath(docMiss, []) === docMiss, "resolveShadowPath empty shadowPath keeps container", String(locatorMod.resolveShadowPath(docMiss, []) === docMiss));

  // ── waitForCondition: text appears → ok; timeout → WAIT_TIMEOUT ──
  const wfSaved = global.document;
  const wfMockDoc = { body: { innerText: "" }, querySelector: () => null, querySelectorAll: () => [] };
  global.document = wfMockDoc;
  global.location = { href: "https://x.example/page" };
  const wfTimeout = await contentExecMod.waitForCondition({ text: "加载完成", timeout: 100 });
  assert(!wfTimeout.ok && wfTimeout.errorCode === "WAIT_TIMEOUT", "waitForCondition times out with WAIT_TIMEOUT");
  const wfSel = await contentExecMod.waitForCondition({ selector: ".x", timeout: 100 });
  assert(!wfSel.ok && wfSel.errorCode === "WAIT_TIMEOUT", "waitForCondition selector absent times out");
  wfMockDoc.body.innerText = "加载完成";
  const wfOk = await contentExecMod.waitForCondition({ text: "加载完成", timeout: 500 });
  global.document = wfSaved;
  assert(wfOk.ok, "waitForCondition succeeds when text present");

  // ── waitForCondition: matches text inside open shadow root via textContent ──
  const wfShadowRoot = {
    mode: "open",
    isShadowRoot: true,
    textContent: "弹窗内：加载完成",
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const wfShadowHost = { nodeType: 1, shadowRoot: wfShadowRoot, querySelectorAll: () => [] };
  const wfShadowDoc = {
    body: { innerText: "" },
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === "iframe" ? [] : sel === "*" ? [wfShadowHost] : []),
  };
  global.document = wfShadowDoc;
  global.location = { href: "https://x.example/page" };
  const wfShadow = await contentExecMod.waitForCondition({ text: "加载完成", timeout: 100 });
  global.document = wfSaved;
  assert(wfShadow.ok, "waitForCondition matches text inside open shadow root");

  // ── snapshotStats summary ──
  const stats = protocol.snapshotStats(snap);
  assert(stats.includes("2 elements"), "snapshotStats reports element count");
  assert(stats.includes("url: https://x.com"), "snapshotStats includes url");
  assertEq(protocol.snapshotStats(null), "(no snapshot)", "snapshotStats null safe");

  // ── storage ──
  const s = storage.normalizeSettings({ apiKey: "k" });
  assertEq(s.provider, "openai", "normalizeSettings provider default");
  assertEq(s.apiKey, "k", "normalizeSettings keeps apiKey");
  const sv = storage.normalizeSettings({ vision: { model: "glm-4v-flash" } }).vision;
  assertEq(sv.model, "glm-4v-flash", "normalizeSettings keeps vision model");
  assertEq(sv.baseURL, "https://open.bigmodel.cn/api/paas/v4", "normalizeSettings vision baseURL default");
  const svEmpty = storage.normalizeSettings({}).vision;
  assertEq(svEmpty.model, "", "normalizeSettings vision model default empty (falls back to main)");
  assertEq(svEmpty.provider, "openai", "normalizeSettings vision provider default");
   const ss = storage.normalizeSettings({ sync: { enabled: true, serverUrl: "https://s" } }).sync;
   assertEq(ss.enabled, true, "normalizeSettings keeps sync.enabled");
   assertEq(ss.serverUrl, "https://s", "normalizeSettings keeps sync.serverUrl");
   assertEq(ss.lastSyncAt, 0, "normalizeSettings sync.lastSyncAt default 0");
  const ssDef = storage.normalizeSettings({}).sync;
  assertEq(ssDef.enabled, false, "normalizeSettings sync default disabled");

  // ── LLM provider presets (小白免配置) ──
  assert(storage.PROVIDER_PRESETS.length >= 5, "provider presets ship common options");
  const pOpenai = storage.findProviderPreset("openai");
  assert(pOpenai && pOpenai.baseURL === "https://api.openai.com/v1", "openai preset has base URL");
  const pDeepseek = storage.findProviderPreset("deepseek");
  assert(pDeepseek && pDeepseek.model === "deepseek-chat", "deepseek preset has model");
  const pOllama = storage.findProviderPreset("ollama");
  assert(pOllama && pOllama.local === true, "ollama preset marked local");
  assert(storage.isLocalProvider("ollama"), "isLocalProvider true for ollama");
  assert(storage.isLocalProvider("lmstudio"), "isLocalProvider true for lmstudio");
  assert(!storage.isLocalProvider("openai"), "isLocalProvider false for openai");
  assert(!storage.isLocalProvider("deepseek"), "isLocalProvider false for deepseek");
  assert(!storage.isLocalProvider("nonsense"), "isLocalProvider false for unknown provider");
  assertEq(storage.findProviderPreset("nonsense"), null, "findProviderPreset null for unknown");
  const resDeepseek = storage.resolveProviderSettings("deepseek", {});
  assertEq(resDeepseek.provider, "deepseek", "resolveProviderSettings keeps provider id");
  assertEq(resDeepseek.model, "deepseek-chat", "resolveProviderSettings fills preset model when blank");
  assertEq(resDeepseek.baseURL, "https://api.deepseek.com/v1", "resolveProviderSettings fills preset baseURL when blank");
  const resOverride = storage.resolveProviderSettings("ollama", { model: "qwen2.5", baseURL: "http://127.0.0.1:11434/v1" });
  assertEq(resOverride.model, "qwen2.5", "resolveProviderSettings keeps explicit model override");
  assertEq(resOverride.baseURL, "http://127.0.0.1:11434/v1", "resolveProviderSettings keeps explicit baseURL override");
  assertEq(resOverride.provider, "ollama", "resolveProviderSettings keeps local provider id");
  const resUnknown = storage.resolveProviderSettings("weird", { model: "m", baseURL: "u" });
  assertEq(resUnknown.provider, "openai", "resolveProviderSettings falls back to openai for unknown id");
  assertEq(resUnknown.model, "m", "resolveProviderSettings keeps overrides on fallback");
  const resCustom = storage.resolveProviderSettings("custom", {});
  assertEq(resCustom.provider, "custom", "custom provider preserved");
  const resCustomBlank = storage.resolveProviderSettings("custom", { model: "", baseURL: "" });
  assertEq(resCustomBlank.model, "", "custom provider keeps blank model");
  assertEq(resCustomBlank.baseURL, "", "custom provider keeps blank baseURL");
  assert(storage.PROVIDER_PRESETS.some((p) => p.id === "custom"), "presets include a custom option");
  // onboarding flag normalization
  assert(storage.normalizeOnboarding(true), "normalizeOnboarding true");
  assert(storage.normalizeOnboarding(1), "normalizeOnboarding 1");
  assert(storage.normalizeOnboarding("1"), "normalizeOnboarding '1'");
  assert(!storage.normalizeOnboarding(false), "normalizeOnboarding false");
  assert(!storage.normalizeOnboarding(undefined), "normalizeOnboarding undefined");
  assert(!storage.normalizeOnboarding(null), "normalizeOnboarding null");
  assert(!storage.normalizeOnboarding(0), "normalizeOnboarding 0");

  // ── history ──
  const histStore = {};
  global.chrome = { storage: { local: {
    get: async (key) => ({ [key]: histStore[key] }),
    set: async (obj) => { Object.assign(histStore, obj); },
    remove: async (key) => { delete histStore[key]; },
  } } };
  await historyMod.clearHistory();
  const hist1 = historyMod.normalizeRecord({ id: "a", goal: "点登录", status: "done", logs: [{ tag: "step", text: "x" }] });
  assertEq(hist1.goal, "点登录", "normalizeRecord keeps goal");
  assertEq(hist1.recoveries, 0, "normalizeRecord defaults recoveries");
  await historyMod.addHistoryRecord({ id: "a", goal: "任务A", status: "done", startedAt: 1, logs: [{ tag: "step", text: "s1" }] });
  await historyMod.addHistoryRecord({ id: "b", goal: "任务B", status: "error", startedAt: 2, logs: [{ tag: "tool", text: "t1" }] });
  const histAll = await historyMod.getHistory();
  assertEq(histAll.length, 2, "history stores both records");
  assertEq(histAll[0].goal, "任务B", "history newest first");
  assertEq(histAll[1].logs.length, 1, "history keeps logs");
  const many = [];
  for (let i = 0; i < historyMod.MAX_RECORDS + 5; i++) many.push({ id: "r" + i, goal: "g" + i, status: "done" });
  for (const r of many) await historyMod.addHistoryRecord(r);
  const capped = await historyMod.getHistory();
  assertEq(capped.length, historyMod.MAX_RECORDS, "history capped at MAX_RECORDS");
  // With a sync session present, the cap relaxes to SYNC_MAX_RECORDS.
  histStore.mioSession = { token: "t", email: "e", serverUrl: "https://sync.example.com" };
  for (let i = 0; i < historyMod.MAX_RECORDS + 5; i++) await historyMod.addHistoryRecord({ id: "syn" + i, goal: "g" + i, status: "done" });
  const synced = await historyMod.getHistory();
  assert(synced.length > historyMod.MAX_RECORDS, "synced account relaxes the history cap");
  assert(synced.length <= historyMod.SYNC_MAX_RECORDS, "synced history still bounded by SYNC_MAX_RECORDS");
  assertEq(await historyMod.getMaxRecords(), historyMod.SYNC_MAX_RECORDS, "getMaxRecords returns SYNC cap when logged in");
  assert(await historyMod.isSynced(), "isSynced true with session");
  delete histStore.mioSession;
  assertEq(await historyMod.getMaxRecords(), historyMod.MAX_RECORDS, "getMaxRecords falls back to LOCAL cap when logged out");
  assert(!await historyMod.isSynced(), "isSynced false without session");
  await historyMod.clearHistory();
  assertEq((await historyMod.getHistory()).length, 0, "clearHistory empties storage");
  // P2: pinned / tags / update / filter / sort
  const p1 = historyMod.normalizeRecord({ id: "p1", goal: "比价", status: "done", pinned: true, tags: ["购物", "对比"] });
  assert(p1.pinned, "normalizeRecord keeps pinned");
  assertEq(p1.tags.length, 2, "normalizeRecord keeps tags");
  assertEq(historyMod.normalizeRecord({ id: "p2" }).pinned, false, "normalizeRecord defaults pinned false");
  await historyMod.addHistoryRecord({ id: "p1", goal: "比价", status: "done", startedAt: 10, pinned: true, tags: ["购物"] });
  await historyMod.addHistoryRecord({ id: "p2", goal: "发邮件", status: "error", startedAt: 20 });
  const upd = await historyMod.updateHistoryRecord("p2", { tags: ["工作"], pinned: true });
  assert(upd.find((r) => r.id === "p2").pinned, "updateHistoryRecord sets pinned");
  assertEq(upd.find((r) => r.id === "p2").tags[0], "工作", "updateHistoryRecord sets tags");
  const filtered = historyMod.filterRecords(await historyMod.getHistory(), "购物");
  assertEq(filtered.length, 1, "filterRecords matches tag");
  const byGoal = historyMod.filterRecords(await historyMod.getHistory(), "比价");
  assertEq(byGoal.length, 1, "filterRecords matches goal");
  const all = historyMod.filterRecords(await historyMod.getHistory(), "");
  assertEq(all.length, 2, "filterRecords empty query returns all");
  assert(all[0].pinned, "sortRecords puts pinned first");

  // ── history.js 持久化 stepEvents（含封顶）──
  const manyEvents = Array.from({ length: 150 }, (_, i) => ({ type: "tool_failed", stepIndex: 0, name: "x" + i }));
  const norm = historyMod.normalizeRecord({ id: "r1", goal: "g", logs: [{ tag: "tool", text: "ok" }], stepEvents: manyEvents });
  assert(Array.isArray(norm.stepEvents), "normalizeRecord keeps stepEvents");
  assert(norm.stepEvents.length === 100, "normalizeRecord caps stepEvents at 100", String(norm.stepEvents.length));
  const normEmpty = historyMod.normalizeRecord({ goal: "g" });
  assert(Array.isArray(normEmpty.stepEvents) && normEmpty.stepEvents.length === 0, "normalizeRecord defaults stepEvents to []");

  // ── importRecords: merge exported JSON, dedupe by id, cap at MAX_RECORDS ──
  await historyMod.addHistoryRecord({ id: "x1", goal: "既有任务", status: "done", startedAt: 5 });
  const imp1 = await historyMod.importRecords([
    { id: "x1", goal: "既有任务" },
    { id: "y1", goal: "导入任务", status: "error", tags: ["迁移"] },
  ]);
  assert(imp1.find((r) => r.id === "y1"), "importRecords adds new record");
  assertEq(imp1.filter((r) => r.id === "x1").length, 1, "importRecords dedupes existing id");
  assertEq(imp1.filter((r) => r.id === "y1")[0].tags[0], "迁移", "importRecords keeps tags");
  const impSingle = await historyMod.importRecords({ id: "z1", goal: "单条" });
  assert(impSingle.find((r) => r.id === "z1"), "importRecords accepts a single object");
  let impThrew = false;
  try { await historyMod.importRecords({ not: "records" }); } catch (_) { impThrew = true; }
  assert(impThrew, "importRecords rejects invalid payload");
  const impBad = await historyMod.importRecords([{ no: "id" }]);
  assert(!impBad.find((r) => !r.id), "importRecords skips records without id");

  // ── buildShareRecord: shareable snapshot strips resume / sensitive state ──
  const shareSrc = { id: "share1", goal: "跨站任务", status: "done", summary: "完成", startedAt: 1, finishedAt: 2, recoveries: 3, replans: 1, tags: ["跨站"], logs: [{ tag: "recover", text: "x" }], resume: { plan: {}, nextStepIndex: 4, notes: { 密码: "secret" } } };
  const shareRec = historyMod.buildShareRecord(shareSrc);
  assertEq(shareRec.app, "mio", "share record marks app");
  assertEq(shareRec.goal, "跨站任务", "share record keeps goal");
  assertEq(shareRec.recoveries, 3, "share record keeps recovery count");
  assertEq(shareRec.logs.length, 1, "share record keeps logs");
  assert(shareRec.resume === undefined, "share record strips resume (no checkpoint leak)");
  assert(shareRec.notes === undefined, "share record strips notes (no credential leak)");
  assertEq(shareRec.id, "share1", "share record keeps id so it can be re-imported");
  const shareMany = historyMod.buildShareRecord({ id: "x", goal: "g", logs: Array.from({ length: 400 }, (_, i) => ({ tag: "step", text: "l" + i })) });
  assertEq(shareMany.logs.length, 300, "share record caps logs at 300");
  const reimport = await historyMod.importRecords([shareRec]);
  assert(!!reimport.find((r) => r.id === "share1"), "share record round-trips through importRecords");

  // ── templates ──
  assert(templatesMod.TEMPLATES.length >= 4, "templates module ships common tasks");
  const tCross = templatesMod.findTemplateById("cross-site");
  assert(tCross, "templates include cross-site template");
  const filled = templatesMod.applyTemplate(tCross, { source: "淘宝", target: "京东", item: "手机壳" });
  assert(filled.includes("淘宝") && filled.includes("京东"), "applyTemplate substitutes placeholders");
  assert(filled.includes("memo"), "cross-site template mentions memo");
  const noFill = templatesMod.applyTemplate(tCross, {});
  assert(noFill.includes("{source}"), "applyTemplate leaves unknown placeholders intact");
  assertEq(JSON.stringify(templatesMod.extractPlaceholders(tCross.goal)), JSON.stringify(["source", "item", "target"]), "extractPlaceholders lists unique placeholder keys");
  assertEq(JSON.stringify(templatesMod.extractPlaceholders("无占位符")), JSON.stringify([]), "extractPlaceholders empty for plain text");
  // New high-frequency built-in templates (share/传播 friendly)
  assert(templatesMod.findTemplateById("daily-signin"), "templates include daily-signin");
  assert(templatesMod.findTemplateById("price-watch"), "templates include price-watch");
  assert(templatesMod.findTemplateById("daily-report"), "templates include daily-report");
  assert(templatesMod.findTemplateById("course-snatch"), "templates include course-snatch");

  // ── template share round-trip (buildShareTemplate / parseShareTemplate) ──
  const shareTpl = templatesMod.buildShareTemplate({ label: "抢课", goal: "打开 {site} 选课，抢「{course}」", hint: "秒杀" });
  assertEq(shareTpl.app, "mio", "share template marks app");
  assertEq(shareTpl.version, 1, "share template marks version");
  assertEq(shareTpl.type, "template", "share template marks type");
  assertEq(JSON.stringify(shareTpl.placeholders), JSON.stringify(["site", "course"]), "share template lists placeholders");
  assert(shareTpl.goal.includes("{site}"), "share template keeps goal placeholders intact");
  assert(shareTpl.goal === undefined || !String(shareTpl.goal).match(/token|password|apiKey/i), "share template never carries secrets in goal shape");
  const reimported = templatesMod.parseShareTemplate(JSON.stringify(shareTpl));
  assertEq(reimported.goal, shareTpl.goal, "parseShareTemplate round-trips goal from JSON string");
  assertEq(reimported.label, "抢课", "parseShareTemplate keeps label");
  assertEq(JSON.stringify(templatesMod.parseShareTemplate(shareTpl)), JSON.stringify({ label: "抢课", goal: shareTpl.goal, hint: "秒杀" }), "parseShareTemplate accepts parsed object");
  // Invalid payloads are rejected with clear errors.
  let tplThrew = null;
  try { templatesMod.parseShareTemplate("not json"); } catch (e) { tplThrew = e.message; }
  assert(tplThrew, "parseShareTemplate rejects invalid JSON");
  try { templatesMod.parseShareTemplate({ type: "history", goal: "x" }); } catch (e) { tplThrew = e.message; }
  assert(tplThrew, "parseShareTemplate rejects wrong type");
  try { templatesMod.parseShareTemplate({ type: "template" }); } catch (e) { tplThrew = e.message; }
  assert(tplThrew, "parseShareTemplate rejects missing goal");
  assertEq(templatesMod.parseShareTemplate({ type: "template", goal: "  签到  " }).goal, "签到", "parseShareTemplate trims goal");

  await historyMod.clearHistory();
  delete global.chrome;

  // ── adapter normalize ──
  const comp = adapterMod.normalizeCompletion({
    content: "", tool_calls: [{ id: "a", function: { name: "click", arguments: '{ "index": 3 }' } }],
  });
  assertEq(comp.toolCalls.length, 1, "normalizeCompletion parses tool_calls");
  assertEq(comp.toolCalls[0].name, "click", "normalizeCompletion tool name");
  assertEq(comp.toolCalls[0].args.index, 3, "normalizeCompletion parses args");
  const bad = adapterMod.normalizeCompletion({
    content: "", tool_calls: [{ id: "b", function: { name: "click", arguments: "not json" } }],
  });
  assert(!!bad.toolCalls[0].args._parseError, "normalizeCompletion tolerates bad JSON");

  // ── openai adapter ──
  const realFetch = global.fetch;
  const posted = [];
  global.fetch = async (url, opts) => {
    posted.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ choices: [{ message: {
      content: "hi", tool_calls: [{ id: "c1", type: "function", function: { name: "click", arguments: '{"index":1}' } }],
    } }] }) };
  };
  const adapter = adapterMod.createAdapter({ provider: "openai", model: "m", baseURL: "https://api.openai.com/v1", apiKey: "k" });
  const out = await adapter.generate([{ role: "user", content: "x" }], {
    tools: [{ type: "function", function: { name: "click", parameters: {} } }],
  });
  assertEq(out.toolCalls[0].name, "click", "openai adapter parses tool call");
  assertEq(posted[0].url, "https://api.openai.com/v1/chat/completions", "openai posts to chat/completions");
  assertEq(posted[0].body.model, "m", "openai sends model");

  let attempts = 0;
  global.fetch = async () => {
    attempts++;
    if (attempts < 3) throw new Error("network flaky");
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok", tool_calls: [] } }] }) };
  };
  const out2 = await adapter.generate([{ role: "user", content: "x" }]);
  assertEq(attempts, 3, "openai adapter retries transient errors");

  attempts = 0;
  global.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
  let threw = false;
  try { await adapter.generate([{ role: "user", content: "x" }]); } catch (_) { threw = true; }
  assert(threw, "openai adapter throws on persistent HTTP error");

  // non-retriable 4xx (invalid API key) fails after exactly 1 attempt
  attempts = 0;
  global.fetch = async () => { attempts++; return { ok: false, status: 401, text: async () => "invalid key" }; };
  let threw401 = false;
  try { await adapter.generate([{ role: "user", content: "x" }]); } catch (_) { threw401 = true; }
  assert(threw401, "openai adapter throws on 401");
  assertEq(attempts, 1, "openai adapter does not retry 4xx errors");

  // ── anthropic adapter ──
  const anthropicPosted = [];
  global.fetch = async (url, opts) => {
    anthropicPosted.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, json: async () => ({
      content: [
        { type: "text", text: "我想点击" },
        { type: "tool_use", id: "tu1", name: "click", input: { index: 1 } },
      ],
    }) };
  };
  const anthropicAdapter = adapterMod.createAdapter({ provider: "anthropic", model: "claude-x", baseURL: "https://api.anthropic.com/v1", apiKey: "ak" });
  const anthropicOut = await anthropicAdapter.generate(
    [
      { role: "system", content: "You are an agent." },
      { role: "user", content: "hi" },
    ],
    { tools: [{ type: "function", function: { name: "click", description: "click", parameters: { type: "object", properties: {} } } }] }
  );
  assertEq(anthropicOut.toolCalls[0].name, "click", "anthropic adapter parses tool_use");
  assertEq(anthropicOut.toolCalls[0].args.index, 1, "anthropic adapter parses tool input");
  assertEq(anthropicOut.content, "我想点击", "anthropic adapter joins text blocks");
  const aReq = anthropicPosted[0];
  assertEq(aReq.url, "https://api.anthropic.com/v1/messages", "anthropic posts to /v1/messages");
  assertEq(aReq.headers["x-api-key"], "ak", "anthropic sends x-api-key");
  assertEq(aReq.headers["anthropic-version"], "2023-06-01", "anthropic sends version header");
  assertEq(aReq.body.system, "You are an agent.", "anthropic lifts system out of messages");
  assertEq(aReq.body.model, "claude-x", "anthropic sends model");
  assertEq(aReq.body.tools[0].name, "click", "anthropic converts tool to input_schema form");
  assert(aReq.body.tools[0].input_schema, "anthropic tool has input_schema");
  assertEq(aReq.body.messages.length, 1, "anthropic messages exclude system");
  assertEq(aReq.body.messages[0].content[0].text, "hi", "anthropic user text wrapped in block");

  // ── anthropic: assistant tool_use + tool_result round-trip ──
  const aPosted2 = [];
  global.fetch = async (url, opts) => { aPosted2.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ content: [{ type: "text", text: "done" }] }) }; };
  await anthropicAdapter.generate([
    { role: "user", content: "go" },
    { role: "assistant", content: "", tool_calls: [{ id: "c9", type: "function", function: { name: "click", arguments: "{\"index\":2}" } }] },
    { role: "tool", tool_call_id: "c9", content: "{\"ok\":true}" },
  ]);
  const aMsgs2 = aPosted2[0].messages;
  assertEq(aMsgs2[1].role, "assistant", "anthropic assistant message present");
  assertEq(aMsgs2[1].content[0].type, "tool_use", "anthropic tool_calls become tool_use blocks");
  assertEq(aMsgs2[1].content[0].name, "click", "anthropic tool_use has name");
  assertEq(aMsgs2[1].content[0].input.index, 2, "anthropic tool_use carries parsed input");
  assertEq(aMsgs2[2].role, "user", "anthropic tool result lives in a user message");
  assertEq(aMsgs2[2].content[0].type, "tool_result", "anthropic tool result block type");
  assertEq(aMsgs2[2].content[0].tool_use_id, "c9", "anthropic tool_result references tool_use id");

  // ── anthropic: images become base64 source blocks ──
  const aPosted3 = [];
  global.fetch = async (url, opts) => { aPosted3.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }; };
  await anthropicAdapter.generate(
    [{ role: "user", content: "see" }],
    { images: ["data:image/png;base64,AAAA"] }
  );
  const imgBlock = aPosted3[0].messages[0].content[1];
  assertEq(imgBlock.type, "image", "anthropic image block type");
  assertEq(imgBlock.source.type, "base64", "anthropic base64 source");
  assertEq(imgBlock.source.media_type, "image/png", "anthropic media type parsed");
  assertEq(imgBlock.source.data, "AAAA", "anthropic base64 data passed through");

  global.fetch = realFetch;

  // ── tools registry (pure browser actions, no finish) ──
  const names = registryMod.listTools();
  ["click", "type", "scroll", "wait", "navigate", "extract_text", "paste", "tab"].forEach((n) => {
    assert(names.includes(n), "registry has tool " + n);
  });
  assert(!names.includes("finish"), "registry does not include finish (runtime control plane)");
  const schema = registryMod.getToolsSchema();
  assert(schema.length >= 8, "getToolsSchema returns >= 8 browser tools");
  const clickTool = registryMod.getTool("click");
  assert(clickTool.parameters.required.includes("index"), "click tool requires index");

  // ── tool execution (click resolves snapshot index → bridge) ──
  const bridgeCalls = [];
  const bridgeStub = {
    executeAction: async (action) => { bridgeCalls.push(action); return { ok: true, value: "done" }; },
  };
  const snapStub = { elements: [{ index: 0, role: "button", name: "登录" }] };
  const r1 = await registryMod.getTool("click").execute({ index: 0 }, { bridge: bridgeStub, snapshot: snapStub });
  assert(r1.ok, "click tool returns ok");
  assertEq(bridgeCalls[0].target.index, 0, "click tool resolves target by index");
  const r2 = await registryMod.getTool("click").execute({ index: 99 }, { bridge: bridgeStub, snapshot: snapStub });
  assert(!r2.ok && r2.error.includes("99"), "click tool errors on missing index");

  // ── extract_text tool proxies to bridge ──
  const extractCalls = [];
  const extractBridge = { executeAction: async (a) => { extractCalls.push(a); return { ok: true, value: { url: "u", title: "t", text: "body" } }; } };
  const er = await registryMod.getTool("extract_text").execute({ maxChars: 2000 }, { bridge: extractBridge, snapshot: snapStub });
  assert(er.ok, "extract_text tool returns ok");
  assertEq(extractCalls[0].name, "extract_text", "extract_text tool forwards action name");
  assertEq(extractCalls[0].args.maxChars, 2000, "extract_text tool forwards maxChars");

  // ── paste tool resolves target and forwards text ──
  const pasteCalls = [];
  const pasteBridge = { executeAction: async (a) => { pasteCalls.push(a); return { ok: true, value: "pasted 5 chars" }; } };
  const pr = await registryMod.getTool("paste").execute({ index: 0, text: "小说正文" }, { bridge: pasteBridge, snapshot: snapStub });
  assert(pr.ok, "paste tool returns ok");
  assertEq(pasteCalls[0].target.index, 0, "paste tool resolves target by index");
  assertEq(pasteCalls[0].args.text, "小说正文", "paste tool forwards text");
  const pMissing = await registryMod.getTool("paste").execute({ index: 99, text: "x" }, { bridge: pasteBridge, snapshot: snapStub });
  assert(!pMissing.ok && pMissing.error.includes("99"), "paste tool errors on missing index");

  // ── tab tool routes modes to bridge ──
  const tabCalls = [];
  const tabBridge = {
    tabNew: async (url) => { tabCalls.push(["open", url]); return { index: 3, url }; },
    tabList: async () => { tabCalls.push(["list"]); return [{ index: 0, title: "t0", url: "u0", active: true }]; },
    tabSwitch: async (i) => { tabCalls.push(["switch", i]); return { ok: true, title: "t0" }; },
    tabClose: async (i) => { tabCalls.push(["close", i]); return { ok: true, closed: "t0" }; },
  };
  const to = await registryMod.getTool("tab").execute({ mode: "open", url: "https://b.example" }, { bridge: tabBridge, snapshot: snapStub });
  assert(to.ok && to.value.includes("opened tab 3"), "tab open routes to bridge");
  const tl = await registryMod.getTool("tab").execute({ mode: "list" }, { bridge: tabBridge, snapshot: snapStub });
  assert(tl.ok && tl.value.description.includes("[0] t0 u0 (active)"), "tab list returns tab descriptions");
  const ts = await registryMod.getTool("tab").execute({ mode: "switch", index: 0 }, { bridge: tabBridge, snapshot: snapStub });
  assert(ts.ok && ts.value.includes("switched"), "tab switch routes to bridge");
  const tc = await registryMod.getTool("tab").execute({ mode: "close", index: 0 }, { bridge: tabBridge, snapshot: snapStub });
  assert(tc.ok && tc.value.includes("closed tab"), "tab close routes to bridge");
  const tb = await registryMod.getTool("tab").execute({ mode: "bogus" }, { bridge: tabBridge, snapshot: snapStub });
  assert(!tb.ok, "tab unknown mode errors");

  // ── navigate tool prefers browser-level navigation, falls back to content ──
  const navCalls = [];
  const navBridge = {
    navigate: async (url) => { navCalls.push(["browser", url]); return { ok: true, value: "navigating to " + url, pendingNavigation: true }; },
    executeAction: async (a) => { navCalls.push(["content", a.args.url]); return { ok: true, value: "content nav" }; },
  };
  const navTool = registryMod.getTool("navigate");
  const navRes1 = await navTool.execute({ url: "https://bing.com" }, { bridge: navBridge });
  assert(navRes1.ok && navCalls[0][0] === "browser", "navigate uses browser-level tabs.update when available");
  const navCalls2 = [];
  const legacyBridge = { executeAction: async (a) => { navCalls2.push(a.args.url); return { ok: true, value: "content nav" }; } };
  const navRes2 = await navTool.execute({ url: "https://x.com" }, { bridge: legacyBridge });
  assert(navRes2.ok && navCalls2[0] === "https://x.com", "navigate falls back to content-script navigation when bridge has no navigate");
  const navCalls3 = [];
  const throwingBridge = {
    navigate: async () => { throw new Error("Cannot access a chrome:// URL"); },
    executeAction: async (a) => { navCalls3.push(a.args.url); return { ok: true, value: "content nav" }; },
  };
  const navRes3 = await navTool.execute({ url: "https://y.com" }, { bridge: throwingBridge });
  assert(navRes3.ok && navCalls3[0] === "https://y.com", "navigate falls back when browser-level navigation throws");
  const navMissing = await navTool.execute({}, { bridge: legacyBridge });
  assert(!navMissing.ok, "navigate requires url");

  // ── memory ──
  const mem = memoryMod.createMemory();
  const s1 = { url: "u", title: "t", elements: [{ role: "button", name: "A" }, { role: "button", name: "B" }] };
  assertEq(mem.remember(s1).added.length, 2, "first remember reports all added");
  const s2 = { url: "u", title: "t", elements: [{ role: "button", name: "A" }, { role: "link", name: "C" }] };
  const d2 = mem.remember(s2);
  assert(d2.added.includes("link:C"), "memory diff detects added");
  assert(d2.removed.includes("button:B"), "memory diff detects removed");

  // ── planner ──
  const planLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "打开页面" }, { description: "搜索" }] })] }),
  ]);
  const planDoc = await plannerMod.plan("搜索东西", planLlm);
  assertEq(planDoc.steps.length, 2, "plan parses steps");
  assertEq(planDoc.steps[1].description, "搜索", "plan keeps step descriptions");
  const emptyPlanLlm = mockLlm([() => ({ content: "no tools", toolCalls: [] })]);
  const fallback = await plannerMod.plan("随便干点啥", emptyPlanLlm);
  assertEq(fallback.steps.length, 1, "plan falls back to single step");

  // ── planner is cross-page aware: prompt guides multi-site tasks ──
  let planCapture = null;
  const planCrossLlm = { generate: async (messages) => { planCapture = messages; return { content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "开邮箱拿验证码" }, { description: "回登录页输入" }] })] }; } };
  const planCross = await plannerMod.plan("用邮箱验证码登录", planCrossLlm);
  assertEq(planCross.steps.length, 2, "plan parses cross-page steps");
  const planSys = JSON.stringify(planCapture[0]);
  assert(planSys.includes("memo"), "planner system prompt mentions memo for carrying data across tabs");
  assert(planSys.includes("tab"), "planner system prompt mentions tab tool");
  assert(planSys.includes("multiple sites") || planSys.includes("MULTIPLE"), "planner system prompt supports cross-site tasks");

  // ── replan includes session notes so already-gathered data is reused ──
  let replanCaptured = null;
  const replanNotesLlm = { generate: async (messages) => { replanCaptured = messages; return { content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "继续" }] })] }; } };
  const replanDoc = await plannerMod.replan("g", { description: "失败步骤" }, replanNotesLlm, {
    done: ["已完成的步骤"],
    notes: { 验证码: "1234", price: "¥59" },
  });
  assert(replanDoc.steps.length === 1, "replan returns revised steps");
  const replanText = JSON.stringify(replanCaptured);
  assert(replanText.includes("1234"), "replan prompt carries gathered notes");
  assert(replanText.includes("已完成的步骤"), "replan prompt lists completed steps");

  // ── replan injects failure guidance so the agent stops repeating the dead end ──
  let replanFailCaptured = null;
  const replanFailLlm = { generate: async (messages) => { replanFailCaptured = messages; return { content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "改用坐标点击" }] })] }; } };
  await plannerMod.replan("g", { description: "点按钮" }, replanFailLlm, { failedError: "SCROLL_AT_END", failedReason: "already at bottom" });
  const replanFailText = JSON.stringify(replanFailCaptured);
  assert(replanFailText.includes("[SCROLL_AT_END]"), "replan prompt carries the failing error code");
  assert(replanFailText.includes("find_by_vision"), "replan prompt gives scroll-boundary guidance");
  assertEq(plannerMod.replanGuidance("ELEMENT_DISABLED").length > 0, true, "replanGuidance covers ELEMENT_DISABLED");
  assertEq(plannerMod.replanGuidance("UNKNOWN_CODE"), "", "replanGuidance returns empty for unknown codes");

  // ── classifyStep + step-type focus blocks ──
  assertEq(executorMod.classifyStep("在登录页输入验证码"), "login", "classifyStep detects login/captcha");
  assertEq(executorMod.classifyStep("发送消息并等待回复"), "send", "classifyStep detects send");
  assertEq(executorMod.classifyStep("打开邮箱拿验证码"), "tab", "classifyStep detects cross-page/tab");
  assertEq(executorMod.classifyStep("提取商品价格"), "extract", "classifyStep detects extract");
  assertEq(executorMod.classifyStep("打开首页并确认加载"), "open", "classifyStep detects open/confirm");
  assertEq(executorMod.classifyStep("随便一个步骤"), "", "classifyStep returns empty for unknown");
  const loginPrompt = executorMod.buildSystemPrompt("g", { steps: [{ description: "登录" }] }, { description: "在登录页输入验证码" });
  assert(loginPrompt.includes("read_captcha"), "login step prompt injects captcha focus");
  assert(loginPrompt.includes("图标按钮") === false, "login step prompt omits send icon rules");
  const openPrompt = executorMod.buildSystemPrompt("g", { steps: [{ description: "打开" }] }, { description: "打开首页并确认加载" });
  assert(openPrompt.includes("页面打开且内容与描述匹配"), "open step prompt injects confirm focus");
  assert(openPrompt.includes("read_captcha") === false, "open step prompt omits captcha rules");
  const plainPrompt = executorMod.buildSystemPrompt("g", { steps: [{ description: "x" }] }, { description: "随便" });
  assert(!plainPrompt.includes("页面打开且内容与描述匹配"), "generic step gets no focus block");
  assert(plainPrompt.includes("Current step: 随便"), "generic step keeps core prompt");

  // ── executor happy path ──
  const snapShots = [{ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "登录" }] }];
  const execBridge = {
    snapshot: async () => snapShots[0],
    executeAction: async (action) => ({ ok: true, value: `did ${action.name}` }),
  };
  const execLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "登录页已打开" })] }),
  ]);
  const logs = [];
  const res = await executorMod.execute(
    { goal: "g", steps: [{ description: "打开登录页" }] },
    {
      llm: execLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: (tag, text) => logs.push([tag, text]),
      replan: async () => { throw new Error("should not replan"); },
      maxTurns: 5, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(res.ok, "executor completes step");
  assertEq(res.summary, "登录页已打开", "executor returns finish summary");
  assert(logs.some(([t, txt]) => t === "tool" && txt.includes("click")), "executor executed click tool");

  // ── finish completes the current step and advances to the next ──
  const stepLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步a完成" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步b完成" })] }),
  ]);
  const stepLogs = [];
  const stepRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "a" }, { description: "b" }] },
    {
      llm: stepLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: (t, txt) => stepLogs.push([t, txt]),
      replan: async () => { throw new Error("no replan"); },
      maxTurns: 3, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(stepRes.ok && stepRes.summary === "步b完成", "finish advances through all steps, last summary reported");
  assert(stepLogs.some(([t, txt]) => t === "step" && txt.includes("[1/2]")), "step 1 executed");
  assert(stepLogs.some(([t, txt]) => t === "step" && txt.includes("[2/2]")), "step 2 executed after finish");

  // ── executor replan on repeated failure ──
  // replan 返回与旧计划完全相同的步骤 = 无进展。防抖应拦截（停止而非
  // 无进展重试到 maxReplans），避免复杂任务反复重规划。这是对用户反馈
  // "复杂任务反复重试/重规划" 的针对性防护。
  const failBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [] }),
    executeAction: async () => ({ ok: false, error: "boom" }),
  };
  const failLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "retried" })] }),
  ]);
  let replanned = 0;
  const res2 = await executorMod.execute(
    { goal: "g", steps: [{ description: "点按钮" }] },
    {
      llm: failLlm, bridge: failBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {},
      replan: async () => { replanned++; return { goal: "g", steps: [{ description: "点按钮" }] }; },
      maxTurns: 5, maxStepRetries: 2, isStopped: () => false,
    }
  );
  assert(replanned === 1, "executor replans after repeated failures");
  assert(!res2.ok && res2.errorCode === "REPLAN_NO_PROGRESS", "identical replan is stopped by the no-progress guard (no endless replan loop)");

  // ── executor 返回步骤事件流（失败透明度数据源）──
  const evBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [] }),
    executeAction: async () => ({ ok: false, error: "boom" }),
  };
  const evLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const evRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "点按钮" }] },
    {
      llm: evLlm, bridge: evBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: () => {},
      replan: async () => { throw new Error("no replan"); },
      maxTurns: 5, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(Array.isArray(evRes.events), "execute returns events array");
  assert(evRes.events.some((e) => e.type === "step_start" && e.description === "点按钮"), "events contain step_start");
  assert(evRes.events.some((e) => e.type === "step_done"), "events contain step_done");
  assert(evRes.events.some((e) => e.type === "recovery" && e.kind === "error" && e.code === "ELEMENT_NOT_FOUND"), "events contain recovery error for failed tool");
  assert(evRes.events.some((e) => e.type === "recovery" && e.kind === "attempt" && e.ok), "events contain recovery attempt");
  assert(evRes.events.some((e) => e.type === "tool_failed" && e.name === "click"), "events contain tool_failed for failed tool");

  // ── agent-runtime 转发 onCheckpoint（修复死回调）──
  const cpCaptured = [];
  const rtCpLlm = { generate: async () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }) };
  const rtCp = runtimeMod.createAgentRuntime({
    settings: {},
    bridge: { snapshot: async () => ({ url: "u", title: "t", elements: [] }), executeAction: async () => ({ ok: true, value: "ok" }) },
    onLog: () => {}, onRecovery: () => {}, onState: () => {}, onProgress: () => {},
    onCheckpoint: (cp) => cpCaptured.push(cp),
    deps: {
      llm: rtCpLlm,
      maxTurns: 2, maxStepRetries: 1, maxSteps: 5,
      notes: { createNotes: () => ({ size: 0, toJSON: () => ({}), get: () => null, set: () => {}, render: () => "" }) },
    },
  });
  const rtResCp = await rtCp.run("g");
  assert(rtResCp.ok, "agent-runtime runs task");
  assert(cpCaptured.length > 0, "agent-runtime forwards onCheckpoint callbacks", String(cpCaptured.length));

  // ── multi-step replan resumes from the failed step, not step 0 ──
  // stepA completes, stepB keeps failing until replan; replan receives the
  // completed-step list (done=["A"]) so the planner avoids redoing step A.
  let replanDoneArg = null;
  let replanFired = false;
  const multiBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "go" }] }),
    executeAction: async (a) => {
      if (a.name === "click" && a.args && a.args.index === 99) return { ok: false, error: "boom" };
      return { ok: true, value: "did " + a.name };
    },
  };
  // Stateful mock: before replan, every action is a failing click (so stepB
  // exhausts its retries); after replan fires, finish succeeds immediately.
  let multiTurn = 0;
  let postReplanFinishes = 0;
  const multiLlm = {
    generate: async () => {
      multiTurn++;
      if (multiTurn <= 2) {
        // stepA: click then finish
        const tc = multiTurn === 1 ? makeToolCall("click", { index: 0 }) : makeToolCall("finish", { summary: "A done" });
        return { content: "", toolCalls: [tc] };
      }
      if (!replanFired) return { content: "", toolCalls: [makeToolCall("click", { index: 99 })] };
      // After replan: first post-replan finish completes B2; the next is C.
      postReplanFinishes++;
      const summary = postReplanFinishes === 1 ? "B2 done" : "C done";
      return { content: "", toolCalls: [makeToolCall("finish", { summary })] };
    },
  };
  let multiReplans = 0;
  const multiRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "A" }, { description: "B" }, { description: "C" }] },
    {
      llm: multiLlm, bridge: multiBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {},
      replan: async (g, step, ctx2) => { multiReplans++; replanFired = true; replanDoneArg = (ctx2 && ctx2.done) || []; return { goal: "g", steps: [{ description: "B2" }, { description: "C" }] }; },
      maxTurns: 12, maxStepRetries: 2, isStopped: () => false,
    }
  );
  assert(multiReplans === 1, "multi-step task replans once");
  assert(multiRes.ok && multiRes.summary === "C done", "multi-step task completes after replan");
  assert(JSON.stringify(replanDoneArg) === JSON.stringify(["A"]), "replan receives the completed step list");

  // ── replan 防抖：即使 maxReplans 较大，replan 一直返回相同步骤也应在
  //    第一次 no-progress 时停止（而非无进展重试到超限）──
  let stuckReplans = 0;
  const stuckLlm = mockLlm(Array.from({ length: 40 }, () =>
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] })  // 永远失败
  ));
  const stuckRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "B" }] },
    {
      llm: stuckLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {},
      replan: async () => { stuckReplans++; return { goal: "g", steps: [{ description: "B" }] }; },  // 每次都返回相同计划
      maxTurns: 2, maxStepRetries: 1, maxReplans: 5, isStopped: () => false,
    }
  );
  assert(!stuckRes.ok, "identical replan eventually fails the task");
  assert(stuckReplans === 1, "identical replan is stopped at the first no-progress replan (got " + stuckReplans + ")");



  // ── executor respects stop ──
  const res3 = await executorMod.execute(
    { goal: "g", steps: [{ description: "s" }] },
    {
      llm: mockLlm([]), bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no"); },
      maxTurns: 1, maxStepRetries: 1, isStopped: () => true,
    }
  );
  assert(!res3.ok && res3.error.includes("stopped"), "executor aborts on stop signal");

  // ── step-outcome verification: a bare finish with no action and no page
  //    change is rejected once, then the agent must actually act ──
  let svClicks = 0;
  const svBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "go" }] }),
    executeAction: async () => { svClicks++; return { ok: true, value: "did" }; },
  };
  const svLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done nothing" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "actually did it" })] }),
  ]);
  const svRes = await executorMod.executeStep(
    { description: "点击按钮" },
    {
      llm: svLlm, bridge: svBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 5, maxRecoveryAttempts: 2,
      verifyStepOutcome: true,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "点击按钮" }] }, goal: "g",
    }
  );
  assert(svRes.ok && svRes.summary === "actually did it", "step-outcome verification lets the corrected step finish");
  assert(svClicks === 1, "step-outcome verification forced a real action (click executed)");

  // ── extract+memo steps count as work: finish passes without page change ──
  const svBridge2 = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "textbox", name: "q" }] }),
    executeAction: async (a) => ({ ok: true, value: a.name === "extract_text" ? { url: "u", title: "t", text: "要点一 要点二 要点三" } : "did " + a.name }),
  };
  const svLlm2 = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("extract_text", { maxChars: 4000 }), makeToolCall("memo", { mode: "set", key: "points", value: "要点一 要点二" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "已提取并保存要点" })] }),
  ]);
  const svRes2 = await executorMod.executeStep(
    { description: "提取正文前 3 个要点并保存到 memo" },
    {
      llm: svLlm2, bridge: svBridge2, memory: memoryMod.createMemory(),
      notes: notesMod.createNotes(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 5, maxRecoveryAttempts: 2,
      verifyStepOutcome: true,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "提取" }] }, goal: "g",
    }
  );
  assert(svRes2.ok && svRes2.summary === "已提取并保存要点", "extract+memo step finish is NOT rejected (page unchanged is fine)");
  const svLogs2 = [];
  const svRes2b = await executorMod.executeStep(
    { description: "提取" },
    {
      llm: mockLlm([
        () => ({ content: "", toolCalls: [makeToolCall("extract_text", { maxChars: 4000 }), makeToolCall("memo", { mode: "set", key: "points", value: "要点一 要点二" })] }),
        () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "已提取" })] }),
      ]),
      bridge: svBridge2, memory: memoryMod.createMemory(),
      notes: notesMod.createNotes(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: (tag, text) => svLogs2.push([tag, text]), isStopped: () => false, maxTurns: 5, maxRecoveryAttempts: 2,
      verifyStepOutcome: true,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "提取" }] }, goal: "g",
    }
  );
  assert(!svLogs2.some(([t, x]) => t === "recovery" && x.includes("STEP_NOT_VERIFIED")), "extract+memo step never triggers STEP_NOT_VERIFIED");

  // Verification off (default): bare finish passes without any action.
  const noVerifyBridge = { snapshot: async () => ({ url: "u", title: "t", elements: [] }), executeAction: async () => ({ ok: true }) };
  const noVerifyLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const noVerifyRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: noVerifyLlm, bridge: noVerifyBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 3, maxRecoveryAttempts: 2,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(noVerifyRes.ok && noVerifyRes.summary === "ok", "bare finish passes when verification is off");

  // ── history consistency: every tool_call_id has a matching tool message ──
  const histLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 }), makeToolCall("type", { index: 0, text: "x" })] }),
  ]);
  const histHistory = [{ role: "system", content: "" }];
  const hres = await executorMod.executeStep(
    { description: "批处理" },
    {
      llm: histLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 2,
      history: histHistory, plan: { goal: "g", steps: [{ description: "批处理" }] }, goal: "g",
    }
  );
  assert(!hres.ok, "batch with failing click fails the step");
  const asst = histHistory.find((m) => m.role === "assistant" && m.tool_calls);
  const toolIds = (asst ? asst.tool_calls : []).map((t) => t.id);
  const toolMsgs = histHistory.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  assert(toolIds.length === 2, "assistant recorded both tool calls");
  assert(toolIds.every((id) => toolMsgs.includes(id)), "every tool_call_id has a matching tool message");

  // ── trimHistory keeps tool turns intact ──
  const th = [
    { role: "system", content: "" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "click", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: "ok" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "", tool_calls: [{ id: "t2", type: "function", function: { name: "click", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t2", content: "ok" },
    { role: "user", content: "u3" },
  ];
  executorMod.trimHistory(th, 5);
  assert(th.length === 5, "trimHistory reduces to maxLen");
  const thAsst = th.filter((m) => m.role === "assistant" && m.tool_calls).flatMap((m) => m.tool_calls.map((t) => t.id));
  const thTools = th.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  assert(thAsst.every((id) => thTools.includes(id)), "trimHistory never orphans tool responses");
  const thToolIds = th.filter((m) => m.role === "tool").length;
  assert(thToolIds === 1, "trimHistory keeps exactly one full tool turn");

  // ── trimHistory injects a completed-steps summary when ctx provides them ──
  const th2 = [
    { role: "system", content: "" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "click", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: "ok" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "", tool_calls: [{ id: "t2", type: "function", function: { name: "click", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t2", content: "ok" },
    { role: "user", content: "u3" },
  ];
  executorMod.trimHistory(th2, 5, {
    completedSteps: [{ description: "打开搜索页", summary: "已打开" }, { description: "提取标题" }],
  });
  const summaryMsg = th2.find((m) => m.role === "user" && m.content.includes("历史摘要"));
  assert(!!summaryMsg, "trimHistory injects a history summary when completed steps exist");
  assert(summaryMsg.content.includes("打开搜索页") && summaryMsg.content.includes("提取标题"), "summary includes completed step descriptions");
  assert(th2.length <= 6, "summary injection keeps history bounded", "len=" + th2.length);

  // ── tool exception fails the step instead of crashing the run ──
  const throwLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
  ]);
  const throwingHistory = [{ role: "system", content: "" }];
  const tres = await executorMod.executeStep(
    { description: "t" },
    {
      llm: throwLlm, bridge: { snapshot: async () => snapShots[0] }, memory: memoryMod.createMemory(),
      getTool: () => ({ execute: async () => { throw new Error("boom"); } }),
      getToolsSchema: () => [],
      onLog: () => {}, isStopped: () => false, maxTurns: 2,
      history: throwingHistory, plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(!tres.ok && tres.error.includes("boom"), "tool exception becomes a failed attempt");
  const tAsst = throwingHistory.find((m) => m.role === "assistant" && m.tool_calls);
  const tIds = (tAsst ? tAsst.tool_calls : []).map((t) => t.id);
  const tMsgs = throwingHistory.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  assert(tIds.every((id) => tMsgs.includes(id)), "tool exception still records matching tool message");

  // ── executor enforces a global maxSteps budget ──
  const capLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
  ]);
  const capRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "a" }, { description: "b" }] },
    {
      llm: capLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no"); },
      maxTurns: 5, maxStepRetries: 3, maxSteps: 1, isStopped: () => false,
    }
  );
  assert(!capRes.ok && capRes.error.includes("exceeded"), "executor enforces global maxSteps budget");

  // ── executeStep routes silent (no-tool) turns through Recovery, exhausting attempts ──
  const silenceLlm = mockLlm([
    () => ({ content: "I see the page", toolCalls: [] }),
    () => ({ content: "still looking", toolCalls: [] }),
    () => ({ content: "still nothing", toolCalls: [] }),
    () => ({ content: "done", toolCalls: [] }),
  ]);
  const silenceRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: silenceLlm, bridge: { snapshot: async () => snapShots[0] }, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 10, maxRecoveryAttempts: 2,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(!silenceRes.ok && silenceRes.errorCode === "RECOVERY_EXHAUSTED", "silent turns exhaust recovery and fail the step");

  // ── repeated completion-like silent text auto-finishes the step ──
  const autoFinishLlm = mockLlm([
    () => ({ content: "The item was successfully added to the cart", toolCalls: [] }),
    () => ({ content: "Item has been added to the cart successfully", toolCalls: [] }),
    () => ({ content: "should not be reached", toolCalls: [] }),
  ]);
  const autoFinishRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: autoFinishLlm, bridge: { snapshot: async () => snapShots[0] }, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 10, maxRecoveryAttempts: 5,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(autoFinishRes.ok, "repeated completion text auto-finishes the step instead of exhausting recovery");
  assert(autoFinishRes.summary.includes("added"), "auto-finish carries the agent's completion text as summary");

  // ── first "done" narration without tools gets ONE correction before auto-end ──
  // The correction turns a "I already did everything" skip into a real action, so
  // steps that still need work are not silently dropped. Two identical narrations
  // still auto-finish (bounded), but a corrected agent executes the tool.
  const correctedLlm = mockLlm([
    () => ({ content: "已完成", toolCalls: [] }),                                     // narration #1 → correction injected
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),         // corrected → actually acts
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "点了登录" })] }),
  ]);
  let correctedClicks = 0;
  const correctedRes = await executorMod.executeStep(
    { description: "点击登录" },
    {
      llm: correctedLlm,
      bridge: {
        snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "登录" }] }),
        executeAction: async () => { correctedClicks++; return { ok: true, value: "clicked" }; },
      },
      memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 10, maxRecoveryAttempts: 5,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "点击登录" }] }, goal: "g",
    }
  );
  assert(correctedRes.ok, "corrected narration turns into a real action");
  assertEq(correctedClicks, 1, "correction drives the agent to execute the click");

  // Two identical completion narrations still auto-finish (bounded, no loop).
  const boundedLlm = mockLlm([
    () => ({ content: "已完成", toolCalls: [] }),
    () => ({ content: "已完成", toolCalls: [] }),
    () => ({ content: "should not be reached", toolCalls: [] }),
  ]);
  const boundedRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: boundedLlm, bridge: { snapshot: async () => snapShots[0] }, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 10, maxRecoveryAttempts: 5,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(boundedRes.ok, "repeated identical completion narrations stay bounded and auto-finish");

  // ── agent-runtime integration ──
  const rtBridge = {
    snapshot: async () => snapShots[0],
    executeAction: async (action) => ({ ok: true, value: "done" }),
  };
  const rtLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "点击登录" }] })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "完成" })] }),
  ]);
  const states = [];
  const rt = runtimeMod.createAgentRuntime({ settings: {}, bridge: rtBridge, onState: (st) => states.push(st), deps: { llm: rtLlm } });
  const rr = await rt.run("点击登录按钮");
  assert(rr.ok, "agent-runtime run completes");
  assert(rr.summary === "完成", "agent-runtime returns final summary");
  assert(states.includes("planning") && states.includes("running") && states.includes("done"), "agent-runtime state transitions");

  const rt2 = runtimeMod.createAgentRuntime({ settings: {}, bridge: rtBridge, deps: { llm: mockLlm([]) } });
  rt2.stop();
  const rr2 = await rt2.run("x");
  assert(!rr2.ok, "agent-runtime respects stop before executing");

  // vision model uses a dedicated adapter when settings.vision is configured
  const seen = [];
  const origAdapter = global.createAdapter;
  global.createAdapter = (s) => { seen.push(s); return { generate: async () => ({ content: "", toolCalls: [] }) }; };
  try {
    runtimeMod.createAgentRuntime({
      settings: { enableVision: true, vision: { provider: "openai", model: "glm-4v-flash", baseURL: "https://open.bigmodel.cn/api/paas/v4", apiKey: "zk" } },
      bridge: rtBridge, deps: { llm: mockLlm([]) },
    });
    const visCall = seen.find((s) => s.model === "glm-4v-flash");
    assert(!!visCall, "runtime builds dedicated vision adapter from settings.vision");
    assert(visCall && visCall.apiKey === "zk", "vision adapter carries its own apiKey (separate from main)");
    const noVis = runtimeMod.createAgentRuntime({
      settings: { enableVision: true, vision: { provider: "openai", model: "", baseURL: "https://open.bigmodel.cn/api/paas/v4", apiKey: "" } },
      bridge: rtBridge, deps: { llm: mockLlm([]) },
    });
    const visCallsAfter = seen.filter((s) => s.model === "glm-4v-flash").length;
    assert(visCallsAfter === 1, "empty vision config does not create a dedicated vision adapter (falls back to main)");
    assert(!!noVis, "runtime still constructs with empty vision config");
  } finally {
    global.createAdapter = origAdapter;
  }

  // ══ Phase 1: Recovery Engine unit tests ══
  const policy = require("../sidepanel/recovery-policy.js");
  const sorted = policy.getAllowedActions("ELEMENT_NOT_FOUND");
  assert(sorted[0].action === "wait_and_retry" && sorted[0].priority === 110, "policy sorts ELEMENT_NOT_FOUND by priority desc (wait first for transient renders)");
  assert(policy.getAllowedActions("ELEMENT_NOT_FOUND").some((a) => a.action === "finish"), "policy includes finish as fallback");
  assert(policy.getAllowedActions("ELEMENT_NOT_FOUND").length === 5, "policy exposes all configured actions (incl dismiss_modal)");
  assert(policy.getAllowedActions("ELEMENT_NOT_FOUND").some((a) => a.action === "dismiss_modal"), "ELEMENT_NOT_FOUND includes dismiss_modal (modal occlusion)");
  assert(policy.getAllowedActions("TIMEOUT").some((a) => a.action === "refresh"), "TIMEOUT includes refresh");
  assert(policy.getAllowedActions("SCROLL_AT_END").some((a) => a.action === "refresh"), "SCROLL_AT_END includes refresh");
  assert(policy.getAllowedActions("CLICK_AT_UNVERIFIED").some((a) => a.action === "refresh"), "CLICK_AT_UNVERIFIED includes refresh");
  assert(policy.getAllowedActions("UNKNOWN_CODE").length === 0, "policy returns empty for unknown error code");
  assert(policy.getMaxAttemptsForAction("NO_TOOL_CALLS", "scroll_and_retry") === 1, "policy exposes per-action max attempts");
  assert(policy.getAllowedActions("SCROLL_AT_END").length > 0, "policy covers SCROLL_AT_END");
  assert(policy.getAllowedActions("SCROLL_AT_END").some((a) => a.action === "retry_snapshot"), "SCROLL_AT_END retries snapshot before giving up");
  assert(policy.getAllowedActions("ELEMENT_DISABLED").length > 0, "policy covers ELEMENT_DISABLED");
  assert(policy.getAllowedActions("ELEMENT_DISABLED").some((a) => a.action === "wait_and_retry"), "ELEMENT_DISABLED waits for state sync");
  assert(policy.getAllowedActions("FIELD_NOT_FOUND").length > 0, "policy covers FIELD_NOT_FOUND");
  assert(policy.getAllowedActions("SUBMIT_NOT_FOUND").length > 0, "policy covers SUBMIT_NOT_FOUND");
  assert(policy.getAllowedActions("SCROLL_AT_END", policy.withVisionFallback()).some((a) => a.action === "vision_locate"), "SCROLL_AT_END gets vision fallback when enabled");

  const reMod = require("../sidepanel/recovery-engine.js");
  const rrResult = await reMod.runRecovery(
    { lastError: { code: "ELEMENT_NOT_FOUND" }, recoveryAttempt: 1, maxRecoveryAttempts: 2, recoveryHistory: [] }
  );
  assert(rrResult.status === "retry" && rrResult.nextTurn === "act" && rrResult.detail.action === "wait_and_retry", "engine picks top-priority wait for first ELEMENT_NOT_FOUND attempt");
  const rrExhaust = await reMod.runRecovery(
    { lastError: { code: "ELEMENT_NOT_FOUND" }, recoveryAttempt: 2, maxRecoveryAttempts: 2, recoveryHistory: ["retry_snapshot"] }
  );
  assert(rrExhaust.status === "finish", "engine finishes when attempts exceeded");
  const rrNoAllowed = await reMod.runRecovery(
    { lastError: { code: "UNKNOWN" }, recoveryAttempt: 1, maxRecoveryAttempts: 2, recoveryHistory: [] }
  );
  assert(rrNoAllowed.status === "finish", "engine finishes when no allowed actions");
  const rrDup = await reMod.runRecovery(
    { lastError: { code: "ELEMENT_NOT_FOUND" }, recoveryAttempt: 1, maxRecoveryAttempts: 2, recoveryHistory: ["wait_and_retry"] }
  );
  assert(rrDup.status === "retry" && rrDup.detail.action === "retry_snapshot", "engine falls back to next priority to avoid consecutive duplicate");

  const resMod = require("../sidepanel/recovery-result.js");
  const rrFromAction = resMod.createRecoveryResultFromAction("scroll_and_retry");
  assert(rrFromAction.status === "retry" && rrFromAction.action === "scroll_and_retry" && rrFromAction.nextTurn === "act", "createRecoveryResultFromAction maps non-finish to retry");
  const rrFinishRes = resMod.createRecoveryResultFromAction("finish");
  assert(rrFinishRes.status === "finish" && rrFinishRes.nextTurn === "finish", "createRecoveryResultFromAction maps finish to finish");

  const metricsMod = require("../sidepanel/metrics.js");
  metricsMod.resetMetrics();
  const t1 = metricsMod.startTrace("goal-x");
  const t2 = metricsMod.startTrace("goal-y");
  assert(t1 !== t2 && /^task_/.test(t1) && metricsMod.getCurrentTraceId() === t2, "generateTraceId produces unique task-prefixed ids");
  metricsMod.startTrace("goal-x");
  metricsMod.recordRecovery();
  metricsMod.recordRecovery();
  metricsMod.recordFinishFailed();
  const mm = metricsMod.getMetrics();
  assert(mm.recoveryCount === 2, "metrics counts recoveries within a trace");
  assert(mm.finishFailedCount === 1, "metrics counts finish failures within a trace");
  metricsMod.resetMetrics();

  const tpMod = require("../sidepanel/runtime-protocol.js");
  const finishMsg = tpMod.makeFinishMessage("ok", "done");
  assert(finishMsg.version === tpMod.PROTOCOL_VERSION && finishMsg.kind === "runtime", "runtime finish message carries version + kind");
  assert(finishMsg.payload.type === "finish" && finishMsg.payload.status === "ok", "runtime finish message carries status in payload");
  const actMsg = tpMod.makeActTurnMessage([{ name: "click", args: { index: 0 } }]);
  assert(actMsg.payload.type === "act" && Array.isArray(actMsg.payload.toolCalls), "runtime act message type + toolCalls");

  const thMod = require("../sidepanel/turn-handler.js");
  const actHandler = new thMod.ActTurnHandler();
  assert(typeof actHandler.buildPrompt === "function" && typeof actHandler.handleResponse === "function", "ActTurnHandler implements handler interface");
  const recoveryHandler = new thMod.RecoveryTurnHandler();
  assert(typeof recoveryHandler.responseSchema === "function", "RecoveryTurnHandler exposes structured response schema");

  const rxMod = require("../sidepanel/recovery-context.js");
  const rctx = rxMod.createRecoveryContext("t", "s", 1, 2, null, { code: "ELEMENT_NOT_FOUND", message: "m" }, [], { elementCount: 0, url: "", title: "" }, { vision: false });
  assert(rctx.capabilities && rctx.capabilities.vision === false && rctx.capabilities.planner === false && rctx.capabilities.ocr === false, "recovery context carries reserved capabilities");

  // ══ 失败提示人话化（common/error-msg.js）══
  assert(errorMsgMod.ERROR_MESSAGES.ELEMENT_NOT_FOUND && errorMsgMod.ERROR_MESSAGES.ELEMENT_NOT_FOUND.human, "ELEMENT_NOT_FOUND has a human message");
  assert(!/ELEMENT_NOT_FOUND/.test(errorMsgMod.errorToHuman("ELEMENT_NOT_FOUND").human), "human message hides the raw error code");
  const humanized = errorMsgMod.humanizeError("ELEMENT_NOT_FOUND", "no element at index 99");
  assert(humanized.includes("没找到") && !humanized.includes("ELEMENT_NOT_FOUND"), "humanizeError turns code+message into Chinese");
  assert(errorMsgMod.humanizeError("ELEMENT_NOT_FOUND", "").includes("没找到"), "humanizeError works without a raw message");
  assert(errorMsgMod.humanizeError("UNKNOWN_CODE", "m").includes("出了问题"), "humanizeError falls back for unknown codes");
  assert(errorMsgMod.humanizeError("RECOVERY_EXHAUSTED", "").includes("没成功"), "humanizeError covers RECOVERY_EXHAUSTED");
  assert(errorMsgMod.humanizeErrorFull("FIELD_NOT_FOUND", "missing: 用户名").includes("表单字段"), "humanizeErrorFull includes advice + detail");
  // recovery events → human narrative
  const humanNarr = errorMsgMod.humanizeRecoveryEvents([
    { kind: "error", code: "ELEMENT_NOT_FOUND", message: "no element" },
    { kind: "attempt", action: "retry_snapshot", ok: true, reason: "重新获取页面快照" },
    { kind: "outcome", outcome: "recovered" },
  ]);
  assert(humanNarr.includes("没找到") && humanNarr.includes("换了个方式"), "humanizeRecoveryEvents tells a readable recovery story");
  assert(humanNarr.includes("重新看了一遍页面"), "attemptLabel maps retry_snapshot to Chinese");
  assertEq(errorMsgMod.humanizeRecoveryEvents([]), "", "humanizeRecoveryEvents empty input");
  assert(errorMsgMod.attemptLabel("vision_locate").includes("视觉"), "attemptLabel maps vision_locate to Chinese");

  // ══ 失败分析（sidepanel/failure-stats.js）══
  const failureStatsMod = require("../sidepanel/failure-stats.js");
  const recA = { status: "done", stepEvents: [
    { type: "recovery", kind: "error", code: "ELEMENT_NOT_FOUND" },
    { type: "recovery", kind: "attempt", action: "retry_snapshot", ok: true },
  ] };
  const recB = { status: "error", stepEvents: [
    { type: "recovery", kind: "error", code: "FIELD_NOT_FOUND" },
    { type: "recovery", kind: "error", code: "ELEMENT_NOT_FOUND" },
    { type: "recovery", kind: "outcome", outcome: "exhausted" },
  ] };
  const recC = { status: "done", stepEvents: [] };
  assertEq(JSON.stringify(failureStatsMod.extractErrorCodes(recA)), JSON.stringify(["ELEMENT_NOT_FOUND"]), "extractErrorCodes dedupes per record");
  assertEq(failureStatsMod.extractErrorCodes(recB).length, 2, "extractErrorCodes collects all codes in a record");
  const agg = failureStatsMod.aggregateErrors([recA, recB, recC]);
  assertEq(agg.ELEMENT_NOT_FOUND, 2, "aggregateErrors counts across records");
  assertEq(agg.FIELD_NOT_FOUND, 1, "aggregateErrors counts distinct codes");
  const top = failureStatsMod.topErrors([recA, recB, recC], 2);
  assertEq(top[0].code, "ELEMENT_NOT_FOUND", "topErrors ranks the most frequent first");
  assertEq(top.length, 2, "topErrors respects n");
  assert(failureStatsMod.isFailed(recB), "isFailed true when status error");
  assert(!failureStatsMod.isFailed(recA), "isFailed false for recovered task");
  assert(failureStatsMod.isFailed({ status: "done", stepEvents: [{ type: "step_failed", stepIndex: 0 }] }), "isFailed detects step_failed");
  const sr = failureStatsMod.successRate([recA, recB, recC]);
  assertEq(sr.total, 3, "successRate counts total");
  assertEq(sr.failed, 1, "successRate counts failed");
  assert(Math.abs(sr.successRate - 2 / 3) < 1e-9, "successRate computes ratio");
  assertEq(failureStatsMod.successRate([]).successRate, 0, "successRate empty list");

  // ELEMENT_NOT_FOUND 策略前置 wait_and_retry（页面瞬态未渲染是 top1 失败）
  const enf = policy.getAllowedActions("ELEMENT_NOT_FOUND");
  assert(enf[0].action === "wait_and_retry", "ELEMENT_NOT_FOUND first recovery is wait (transient page render)");
  assert(enf.some((a) => a.action === "retry_snapshot"), "ELEMENT_NOT_FOUND still retries snapshot after wait");

  // ══ 工具调用人话化（common/tool-labels.js）══
  assertEq(toolLabelsMod.toolNameToChinese("click"), "点击", "toolNameToChinese maps click");
  assertEq(toolLabelsMod.toolNameToChinese("type"), "输入", "toolNameToChinese maps type");
  assertEq(toolLabelsMod.toolNameToChinese("weird_tool"), "weird_tool", "toolNameToChinese falls back to raw name");
  const typeDesc = toolLabelsMod.describeToolCall("type", { text: "hello" });
  assert(typeDesc.includes("输入") && typeDesc.includes("hello"), "describeToolCall renders type+text (got " + JSON.stringify(typeDesc) + ")");
  const navDesc = toolLabelsMod.describeToolCall("navigate", { url: "https://example.com" });
  assert(navDesc.includes("打开网页") && navDesc.includes("example.com"), "describeToolCall renders navigate (got " + JSON.stringify(navDesc) + ")");
  const clickDesc = toolLabelsMod.describeToolCall("click", { index: 3 });
  assert(clickDesc.includes("点击"), "describeToolCall renders click");
  const scrollDown = toolLabelsMod.describeToolCall("scroll", { delta: 400 });
  assert(scrollDown.includes("向下滚动"), "describeToolCall scroll down");
  const scrollUp = toolLabelsMod.describeToolCall("scroll", { delta: -200 });
  assert(scrollUp.includes("向上滚动"), "describeToolCall scroll up");
  const tabOpen = toolLabelsMod.describeToolCall("tab", { mode: "open", url: "https://x.com" });
  assert(tabOpen.includes("新标签页"), "describeToolCall tab open");
  const memoSet = toolLabelsMod.describeToolCall("memo", { mode: "set", key: "价格" });
  assert(memoSet.includes("价格"), "describeToolCall memo set");
  const captcha = toolLabelsMod.describeToolCall("read_captcha", {});
  assert(captcha.includes("验证码"), "describeToolCall read_captcha");
  const form = toolLabelsMod.describeToolCall("form_fill", { fields: { username: "u", password: "p" } });
  assert(form.includes("2 项"), "describeToolCall form_fill counts fields");
  const coords = toolLabelsMod.describeToolCall("click_at", { x: 100, y: 200 });
  assert(coords.includes("100") && coords.includes("200"), "describeToolCall click_at coords");
  const waitSel = toolLabelsMod.describeToolCall("wait", { selector: ".btn" });
  assert(waitSel.includes("等待"), "describeToolCall wait selector");
  assertEq(toolLabelsMod.describeToolCall("extract_text", {}), "读取页面文字", "describeToolCall extract_text");

  // ══ 页面状态分类（common/page-state.js，Browser State P0）══
  assertEq(pageStateMod.classifyPageState({ url: "u", title: "t", elements: [] }), pageStateMod.PAGE_STATES.EMPTY, "empty snapshot -> EMPTY");
  const loginSnap = { url: "https://x.com/login", title: "登录", elements: [
    { role: "textbox", name: "用户名", inputType: "text" },
    { role: "textbox", name: "密码", inputType: "password" },
    { role: "button", name: "登录" },
  ] };
  assertEq(pageStateMod.classifyPageState(loginSnap), "login", "password field -> LOGIN");
  const searchSnap = { url: "https://x.com", title: "首页", elements: [
    { role: "textbox", name: "搜索", placeholder: "输入关键词", inputType: "text" },
    { role: "button", name: "搜索" },
  ] };
  assertEq(pageStateMod.classifyPageState(searchSnap), "search", "search box + submit -> SEARCH");
  const formSnap = { url: "https://x.com/f", title: "表单", elements: [
    { role: "textbox", name: "姓名", inputType: "text" },
    { role: "textbox", name: "邮箱", inputType: "text" },
    { role: "button", name: "提交" },
  ] };
  assertEq(pageStateMod.classifyPageState(formSnap), "form", ">=2 inputs + submit -> FORM");
  const tableSnap = { url: "https://x.com", title: "报表", elements: [
    { role: "row", name: "" }, { role: "cell", name: "" }, { role: "cell", name: "" },
  ] };
  assertEq(pageStateMod.classifyPageState(tableSnap), "table", "table/row elements -> TABLE");
  const listSnap = { url: "https://x.com/search?q=abc", title: "结果", elements: [
    { role: "link", name: "下一页", text: "下一页" },
  ] };
  assertEq(pageStateMod.classifyPageState(listSnap), "list", "next-page link -> LIST");
  const detailSnap = { url: "https://x.com/item/123", title: "商品", elements: [
    { role: "link", name: "首页" }, { role: "button", name: "加入购物车" },
  ] };
  assertEq(pageStateMod.classifyPageState(detailSnap), "detail", "/item/ url -> DETAIL");
  const genericSnap = { url: "https://x.com", title: "首页", elements: [{ role: "link", name: "首页" }] };
  assertEq(pageStateMod.classifyPageState(genericSnap), "generic", "plain page -> GENERIC");
  // 优先级：登录（密码框）> 搜索 > 表格 > 表单 > 列表 > 详情
  const loginWins = { url: "https://x.com/item/1", title: "t", elements: [
    { role: "textbox", name: "密码", inputType: "password" },
  ] };
  assertEq(pageStateMod.classifyPageState(loginWins), "login", "password outranks detail url");
  // 聚焦提示
  const loginFocus = pageStateMod.pageFocusPrompt(loginSnap);
  assert(loginFocus.includes("登录按钮"), "login focus mentions login button (got " + JSON.stringify(loginFocus) + ")");
  const emptyFocus = pageStateMod.pageFocusPrompt({ url: "u", title: "t", elements: [] });
  assert(emptyFocus.includes("等待"), "empty focus tells agent to wait");
  assertEq(pageStateMod.pageFocusPrompt(genericSnap), "", "generic has no focus prompt");

  // ══ Phase 2: recovery actions wired through executor ══
  // retry_snapshot: transient element-not-found on first turn → recovery retries → success on next turn
  const recLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // element missing → ELEMENT_NOT_FOUND
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }),
  ]);
  const recEvents = [];
  const recRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "点按钮" }] },
    {
      llm: recLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => recEvents.push(ev),
      replan: async () => { throw new Error("no replan"); },
      maxTurns: 4, maxStepRetries: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(recRes.ok, "retry_snapshot recovery lets a transient missing-element step succeed");
  assert(recRes.summary === "done", "retry_snapshot recovery reaches finish on the follow-up turn");
  assert(recEvents.some((e) => e.kind === "error" && e.code === "ELEMENT_NOT_FOUND"), "recovery emits error event with code");
  assert(recEvents.some((e) => e.kind === "attempt" && e.action === "wait_and_retry"), "recovery emits wait_and_retry attempt event (new top action for transient misses)");

  // ── onStepEvent: step events streamed in real time during execution ──
  const streamLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // element missing → ELEMENT_NOT_FOUND
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }),
  ]);
  const streamEvents = [];
  const streamRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "点按钮" }] },
    {
      llm: streamLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: () => {}, onStepEvent: (ev) => streamEvents.push(ev),
      replan: async () => { throw new Error("no replan"); },
      maxTurns: 4, maxStepRetries: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(streamRes.ok, "onStepEvent run completes");
  assert(streamEvents.some((e) => e.type === "step_start" && e.stepIndex === 0), "onStepEvent streams step_start live");
  assert(streamEvents.some((e) => e.type === "recovery" && e.kind === "error" && e.code === "ELEMENT_NOT_FOUND"), "onStepEvent streams recovery error live");
  assert(streamEvents.some((e) => e.type === "recovery" && e.kind === "attempt" && e.action === "wait_and_retry"), "onStepEvent streams recovery attempt live");
  assert(streamEvents.some((e) => e.type === "step_done" && e.stepIndex === 0), "onStepEvent streams step_done live");
  assertEq(JSON.stringify(streamRes.events), JSON.stringify(streamEvents), "returned events equal the live stream");

  // ── recovery-events: structured stream + renderer ──
  const revMod = require("../sidepanel/recovery-events.js");
  const evs = revMod.startEvents();
  revMod.addEvent(evs, { kind: "error", stepId: 3, code: "ELEMENT_NOT_FOUND", message: "未找到元素" });
  revMod.addEvent(evs, { kind: "attempt", action: "retry_snapshot", reason: "重新获取页面快照", ok: true, attempt: 1 });
  revMod.addEvent(evs, { kind: "attempt", action: "scroll_and_retry", ok: false, attempt: 2 });
  revMod.addEvent(evs, { kind: "outcome", outcome: "exhausted" });
  assertEq(evs.errorCode, "ELEMENT_NOT_FOUND", "events records error code");
  assertEq(evs.attempts.length, 2, "events records all attempts");
  assertEq(evs.outcome, "exhausted", "events records final outcome");
  const rendered = revMod.renderEventStream(evs);
  assert(rendered.includes("[步骤 4] ❌ 没找到"), "render shows 1-based step + humanized error");
  assert(rendered.includes("✓ retry_snapshot"), "render marks successful attempt");
  assert(rendered.includes("✗ scroll_and_retry"), "render marks failed attempt");
  assert(rendered.includes("恢复用尽"), "render shows exhausted outcome");
  assertEq(revMod.renderEventStream(revMod.startEvents()), "", "empty events render empty");
  const strIdEvs = revMod.startEvents();
  revMod.addEvent(strIdEvs, { kind: "error", stepId: "step-a", code: "X" });
  assert(revMod.renderEventStream(strIdEvs).includes("[步骤 step-a]"), "render keeps string step ids as-is");

  // ── renderStepFailure：给定某步骤的 recovery 事件，渲染失败叙事 ──
  const stepRecovery = [
    { type: "recovery", stepIndex: 0, kind: "error", code: "ELEMENT_NOT_FOUND", message: "未找到元素" },
    { type: "recovery", stepIndex: 0, kind: "attempt", action: "retry_snapshot", reason: "重新获取页面快照", ok: true, attempt: 1 },
    { type: "recovery", stepIndex: 0, kind: "attempt", action: "vision_locate", reason: "视觉确认目标不可见", ok: false, attempt: 2 },
    { type: "recovery", stepIndex: 0, kind: "outcome", outcome: "exhausted" },
  ];
  const narrative = revMod.renderStepFailure(stepRecovery);
  assert(narrative.includes("没找到"), "renderStepFailure shows humanized error");
  assert(narrative.includes("retry_snapshot") && narrative.includes("✓"), "renderStepFailure shows success attempt");
  assert(narrative.includes("vision_locate") && narrative.includes("✗"), "renderStepFailure shows failed attempt");
  assert(narrative.includes("恢复用尽"), "renderStepFailure shows exhausted outcome");
  assertEq(revMod.renderStepFailure([]), "", "renderStepFailure empty returns empty string");

  // scroll_and_retry: attempt 2 avoids duplicate retry_snapshot → issues scroll (delta capped at 800px)
  let scrolled = null;
  const scrollBridge = {
    snapshot: async () => snapShots[0],
    executeAction: async (action) => { if (action.name === "scroll") scrolled = action.args.delta; return { ok: true, value: "scrolled" }; },
  };
  const scrollRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: mockLlm([() => ({ content: "no action yet", toolCalls: [] }), () => ({ content: "still none", toolCalls: [] }), () => ({ content: "still", toolCalls: [] })]), // silent → NO_TOOL_CALLS
      bridge: scrollBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 3, maxRecoveryAttempts: 3,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(scrolled !== null && scrolled <= 800, "scroll_and_retry issues a viewport-capped scroll delta");
  assert(!scrollRes.ok && scrollRes.errorCode === "RECOVERY_EXHAUSTED", "recovery exhausts to finish on repeated silent turns");

  // finish recovery: single silent turn with exhausted budget yields failed finish
  const finRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: mockLlm([() => ({ content: "x", toolCalls: [] }), () => ({ content: "y", toolCalls: [] })]),
      bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 2, maxRecoveryAttempts: 1,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(!finRes.ok && finRes.errorCode === "RECOVERY_EXHAUSTED", "single silent turn with budget 1 finishes failed");

  // ── bridge: merges snapshots across frames (same/cross-origin) via frameId ──
  const fs = require("fs");
  const vm = require("vm");
  global.MSG = protocol.MSG;
  global.make = protocol.make;
  const sent = [];
  const bridgeChrome = {
    tabs: {
      query: async () => [{ id: 1, url: "https://host.example/page" }],
      get: async (id) => ({ id, url: "https://host.example/page" }),
      sendMessage: async (tabId, msg, opts) => {
        sent.push({ frameId: opts && opts.frameId, msg });
        const fid = (opts && opts.frameId) || 0;
        if (msg.type === MSG.SNAPSHOT_REQUEST) {
          const elements = fid === 0
            ? [{ role: "button", name: "主按钮", index: 0, framePath: [] }]
            : [{ role: "textbox", name: "子输入框", index: 0, framePath: [] }];
          return { type: MSG.SNAPSHOT_RESPONSE, payload: { snapshot: { title: "T", url: "u", elements } } };
        }
        if (msg.type === MSG.ACTION_EXECUTE) {
          return { type: MSG.ACTION_RESULT, payload: { result: { ok: true, value: "done-in-frame-" + fid } } };
        }
        return null;
      },
    },
    scripting: { executeScript: async () => {} },
    webNavigation: { getAllFrames: async () => [{ frameId: 0, url: "https://host.example/page" }, { frameId: 5, url: "https://pay.example/checkout" }] },
  };
  global.chrome = bridgeChrome;
  const bridgeSource = fs.readFileSync(require.resolve("../sidepanel/bridge.js"), "utf8");
  vm.runInThisContext(bridgeSource);
  const bridge = createPageBridge();
  const brSnap = await bridge.snapshot();
  assertEq(brSnap.elements.length, 2, "bridge merges main + sub-frame elements");
  assertEq(brSnap.elements[0].frameId, 0, "main frame elements tagged frameId 0");
  assertEq(brSnap.elements[1].frameId, 5, "cross-origin frame elements tagged with its frameId");
  assertEq(brSnap.elements[1].index, 1, "merged element indices stay contiguous");
  const actRes = await bridge.executeAction({ name: "click", target: { frameId: 5, name: "子输入框" } });
  assertEq(actRes.value, "done-in-frame-5", "executeAction routes to target frameId");
  const actMain = await bridge.executeAction({ name: "click", target: { name: "主按钮" } });
  assertEq(actMain.value, "done-in-frame-0", "executeAction without frameId targets main frame");
  assert(sent.some((s) => s.frameId === 5 && s.msg.type === MSG.SNAPSHOT_REQUEST), "snapshot requested per frameId");
  delete global.MSG;
  delete global.make;
  delete global.chrome;

  // ── multi-tab: snapshot carries a BrowserContext overview (tabs + active index) ──
  const multiTabChrome = {
    tabs: {
      query: async () => [
        { id: 1, index: 0, title: "首页", url: "https://a.example", active: false, windowId: 7 },
        { id: 2, index: 1, title: "京东", url: "https://jd.example", active: true, windowId: 7 },
      ],
      get: async (id) => ({ id, index: id === 2 ? 1 : 0, title: id === 2 ? "京东" : "首页", url: id === 2 ? "https://jd.example" : "https://a.example", active: id === 2, windowId: 7 }),
      sendMessage: async () => ({ type: protocol.MSG.SNAPSHOT_RESPONSE, payload: { snapshot: { title: "京东", url: "https://jd.example", elements: [{ role: "button", name: "加购", index: 0, framePath: [] }] } } }),
    },
    scripting: { executeScript: async () => {} },
    webNavigation: { getAllFrames: async () => [{ frameId: 0, url: "https://jd.example" }] },
  };
  const mtCtx = { chrome: multiTabChrome, MSG: protocol.MSG, make: protocol.make };
  vm.createContext(mtCtx);
  vm.runInContext(fs.readFileSync(require.resolve("../sidepanel/bridge.js"), "utf8"), mtCtx);
  const mtSnap = await mtCtx.createPageBridge().snapshot();
  assertEq(mtSnap.tabCount, 2, "multi-tab snapshot reports tab count");
  assertEq(mtSnap.tabIndex, 1, "multi-tab snapshot reports active tab index");
  assertEq(mtSnap.tabs[0].title, "首页", "snapshot lists sibling tabs");
  delete global.MSG;
  delete global.make;
  delete global.chrome;

  // ── snapshotToLines renders BrowserContext header when >1 tab ──
  const tabSnap = { url: "u", title: "t", tabIndex: 1, tabCount: 2, tabs: [{ index: 0, title: "首页", url: "a", active: false }, { index: 1, title: "京东", url: "b", active: true }], elements: [] };
  const tabLines = protocol.snapshotToLines(tabSnap);
  assert(tabLines.includes("Tab 2/2"), "snapshotToLines prefixes active tab position");
  assert(tabLines.includes("Tabs: [0] 首页"), "snapshotToLines lists tabs");
  const singleTabLines = protocol.snapshotToLines({ url: "u", title: "t", tabCount: 1, tabIndex: 0, elements: [] });
  assert(!singleTabLines.includes("Tab 1/1"), "snapshotToLines omits tab prefix for single tab");
  // ── snapshotToLines truncates huge element lists to cap per-turn tokens ──
  const manyElems = Array.from({ length: 200 }, (_, i) => ({ index: i, role: "button", name: "b" + i }));
  const manyLines = protocol.snapshotToLines({ url: "u", title: "t", tabCount: 1, tabIndex: 0, elements: manyElems });
  const renderedCount = (manyLines.match(/\[(\d+)\] button/g) || []).length;
  assert(renderedCount === 60, "snapshotToLines renders at most 60 elements", "rendered " + renderedCount);
  assert(manyLines.includes("还有 140 个元素未列出"), "snapshotToLines notes the truncated count");

  // ── memory: navigation / tab switch does not report a noisy diff ──
  const tabMem = memoryMod.createMemory();
  tabMem.remember({ url: "https://a.example", title: "A", elements: [{ role: "button", name: "X" }] });
  const switched = tabMem.remember({ url: "https://b.example", title: "B", elements: [{ role: "textbox", name: "Y" }] });
  assertEq(switched.added.length, 0, "tab switch suppresses added diff");
  assertEq(switched.removed.length, 0, "tab switch suppresses removed diff");
  const samePage = tabMem.remember({ url: "https://b.example", title: "B", elements: [{ role: "textbox", name: "Z" }] });
  assert(samePage.added.includes("textbox:Z"), "same-page diff still reported after switch");

  // ── notes: session memory survives tab switches, serializes for resume ──
  const n1 = notesMod.createNotes();
  assertEq(n1.size(), 0, "notes start empty");
  n1.set("验证码", "1234");
  n1.set("price", "¥59.90");
  assertEq(n1.get("验证码"), "1234", "notes get returns stored value");
  assertEq(n1.size(), 2, "notes size tracks entries");
  assert(n1.render().includes("验证码: 1234"), "notes render builds readable block");
  const restored = notesMod.createNotes(n1.toJSON());
  assertEq(restored.get("price"), "¥59.90", "notes restore from serialized JSON");
  restored.clear();
  assertEq(restored.size(), 0, "notes clear wipes entries");
  const removed = notesMod.createNotes();
  removed.set("k", "v");
  assert(removed.remove("k"), "notes remove deletes a key");
  assertEq(removed.get("k"), null, "notes get null after remove");

  // ── memo tool: set/get/list/clear round-trip through the registry ──
  const memoCtx = { notes: notesMod.createNotes() };
  const memoTool = registryMod.getTool("memo");
  assert(memoTool, "memo tool registered");
  const setRes = await memoTool.execute({ mode: "set", key: "code", value: "ABCD" }, memoCtx);
  assert(setRes.ok, "memo set succeeds");
  const getRes = await memoTool.execute({ mode: "get", key: "code" }, memoCtx);
  assert(getRes.ok && getRes.value === "ABCD", "memo get returns stored value");
  const listRes = await memoTool.execute({ mode: "list" }, memoCtx);
  assert(listRes.ok && listRes.value.description.includes("code: ABCD"), "memo list renders entries");
  const missingRes = await memoTool.execute({ mode: "get", key: "nope" }, memoCtx);
  assert(!missingRes.ok, "memo get on missing key fails");
  const rmRes = await memoTool.execute({ mode: "remove", key: "code" }, memoCtx);
  assert(rmRes.ok, "memo remove succeeds");
  const clearRes = await memoTool.execute({ mode: "clear" }, memoCtx);
  assert(clearRes.ok && memoCtx.notes.size() === 0, "memo clear wipes all");

  // ── form_fill tool: thin wrapper over the content-side action ──
  const ffBridge = {
    executeAction: async (action) => {
      if (action.name !== "form_fill") return { ok: false, error: "expected form_fill" };
      return { ok: true, value: "did form_fill", fields: action.args.fields };
    },
  };
  const ffCtx = { snapshot: { elements: [] }, bridge: ffBridge };
  const ffTool = registryMod.getTool("form_fill");
  assert(ffTool, "form_fill tool registered");
  const ffRes2 = await ffTool.execute({ fields: { username: "a" }, submit: true }, ffCtx);
  assert(ffRes2.ok && ffRes2.value === "did form_fill", "form_fill forwards fields+submit to bridge");
  assertEq(ffRes2.fields.username, "a", "form_fill passes fields through");
  const ffBad = await ffTool.execute({}, ffCtx);
  assert(!ffBad.ok, "form_fill without fields fails");

  // ── content-side form_fill: mock DOM environment ──
  const savedGlobal = global.document;
  const savedEvent = global.Event;
  const savedMouseEvent = global.MouseEvent;
  const savedPointerEvent = global.PointerEvent;
  const savedWindow = global.window;
  const savedComputeName = global.computeAccessibleName;
  const savedComputeRole = global.computeRole;
  const savedMatchField = global.matchField;
  global.Event = function (type) { this.type = type; };
  global.MouseEvent = function (type) { this.type = type; };
  global.PointerEvent = function (type) { this.type = type; };
  global.window = { innerWidth: 1920, innerHeight: 1080 };
  global.computeAccessibleName = snapshotMod.computeAccessibleName;
  global.computeRole = snapshotMod.computeRole;
  global.matchField = fieldsMod.matchField;

  function mockFormEl(opts) {
    const el = {
      tagName: opts.tagName || "INPUT",
      type: opts.type || "",
      name: opts.name || "",
      placeholder: opts.placeholder || "",
      checked: !!opts.checked,
      value: opts.value || "",
      selectedIndex: opts.selectedIndex || 0,
      disabled: false,
      options: opts.options || [],
      form: opts.form || null,
      offsetParent: opts.offsetParent === undefined ? {} : opts.offsetParent,
      getClientRects: () => [{ width: 10, height: 10 }],
      getBoundingClientRect: () => ({ x: opts.x || 0, y: opts.y || 0, width: 10, height: 10 }),
      getAttribute: (k) => (k === "disabled" || k === "aria-disabled" ? null : null),
      dispatchEvent: () => {},
      click: function () { this.__clicked = (this.__clicked || 0) + 1; },
      _events: [],
    };
    Object.defineProperty(el, "value", {
      configurable: true, writable: true, value: opts.value || "",
    });
    return el;
  }
  function mockForm(elements) {
    const f = {
      tagName: "FORM", elements,
      querySelectorAll: (sel) => {
        if (sel.includes("type='submit'") && f.__submitBtn) return [f.__submitBtn];
        return [];
      },
    };
    elements.forEach((e) => { e.form = f; });
    return f;
  }
  function setupFormFillDom(selMap) {
    global.document = { querySelectorAll: (sel) => selMap[sel] || [] };
  }

  // scenario 1: React-controlled checkbox uses the native prototype setter.
  {
    const proto = global.HTMLInputElement.prototype;
    let setterCalls = 0;
    const savedCheckedDesc = Object.getOwnPropertyDescriptor(proto, "checked");
    Object.defineProperty(proto, "checked", {
      configurable: true,
      set(v) { setterCalls++; Object.defineProperty(this, "checked", { value: v, configurable: true, writable: true }); },
      get() { return this._checked; },
    });
    const cb = mockFormEl({ tagName: "INPUT", type: "checkbox", name: "agree", checked: false });
    Object.defineProperty(cb, "checked", { configurable: true, value: false, writable: true });
    const r = contentExecMod.setCheckboxControl(cb, true);
    assert(r.ok && setterCalls === 1, "setCheckboxControl goes through native setter", JSON.stringify({ r, setterCalls }));
    assert(cb.checked === true, "setCheckboxControl sets checked state");
    if (savedCheckedDesc) Object.defineProperty(proto, "checked", savedCheckedDesc);
    else delete proto.checked;
  }

  // scenario 2: {select:""} placeholder value is refused, not selected.
  {
    const sel = mockFormEl({
      tagName: "SELECT", name: "city",
      options: [{ text: "请选择城市", value: "" }, { text: "上海", value: "sh" }],
      selectedIndex: 0,
    });
    const r = contentExecMod.selectOptionByText(sel, "");
    assert(!r.ok && String(r.error).includes("placeholder"), "selectOptionByText refuses empty text", JSON.stringify(r));
    assert(sel.selectedIndex === 0, "empty select keeps placeholder selected");
  }

  // scenario 3: submit stays in the filled form's scope (two forms on page).
  {
    const fA = mockForm([
      mockFormEl({ tagName: "INPUT", type: "text", name: "username", placeholder: "用户名" }),
      mockFormEl({ tagName: "INPUT", type: "password", name: "password", placeholder: "密码" }),
    ]);
    const fB = mockForm([mockFormEl({ tagName: "INPUT", type: "text", name: "email", placeholder: "邮箱" })]);
    const btnA = mockFormEl({ tagName: "BUTTON", type: "submit", form: fA });
    const btnB = mockFormEl({ tagName: "BUTTON", type: "submit", form: fB });
    btnA.__clicked = 0; btnB.__clicked = 0;
    fA.__submitBtn = btnA; fB.__submitBtn = btnB;
    const controls = [
      { el: fA.elements[0], role: "textbox", name: "用户名", placeholder: "用户名", value: "" },
      { el: fA.elements[1], role: "textbox", name: "密码", placeholder: "密码", value: "" },
    ];
    const btn = contentExecMod.findSubmitButton(controls, fA);
    assert(btn === btnA, "findSubmitButton prefers the filled form's submit button");
  }

  // scenario 4: weak keyword "ok" no longer triggers submit.
  {
    const okBtn = mockFormEl({ tagName: "BUTTON", type: "button", name: "OK" });
    okBtn.__clicked = 0;
    setupFormFillDom({});
    global.document.querySelectorAll = (sel) => (sel.startsWith("form button") ? [] : [okBtn]);
    // reuse executor constant indirectly: build controls so fieldCount >= 2 but
    // weak keywords exclude "ok" now — the only button is "OK", so no submit.
    const controls = [
      { el: mockFormEl({ name: "a" }), role: "textbox", name: "a", placeholder: "", value: "" },
      { el: mockFormEl({ name: "b" }), role: "textbox", name: "b", placeholder: "", value: "" },
    ];
    const btn = contentExecMod.findSubmitButton(controls, null);
    assert(btn === null, "findSubmitButton does not treat OK as a weak submit keyword");
  }

  // scenario 5: matchFieldToControl prefers the more specific synonym.
  {
    const controls = [
      { el: mockFormEl({ name: "password", placeholder: "" }), role: "textbox", name: "密码", placeholder: "", value: "" },
      { el: mockFormEl({ name: "confirm_password", placeholder: "" }), role: "textbox", name: "确认密码", placeholder: "", value: "" },
    ];
    const pw = contentExecMod.matchFieldToControl("password", controls);
    assert(pw === controls[0], "password maps to the bare 密码 field, not 确认密码");
  }

  // scenario 6: collectFormControls collects controls inside open shadow roots.
  {
    const ffShadowInput = { tagName: "INPUT", value: "", checked: false, type: "text", offsetParent: {}, getClientRects: () => [1], form: null, dispatchEvent: () => {}, focus: () => {}, getAttribute: () => null, closest: () => null };
    const ffShadowRoot = { mode: "open", querySelectorAll: () => [ffShadowInput], querySelector: () => null };
    const ffShadowHost = { nodeType: 1, shadowRoot: ffShadowRoot };
    const ffShadowDoc = { querySelectorAll: (sel) => (sel === "*" ? [ffShadowHost] : []), querySelector: () => null };
    const savedDoc = global.document;
    global.document = ffShadowDoc;
    const shadowControls = contentExecMod.collectFormControls();
    global.document = savedDoc;
    assert(shadowControls.some((c) => c.el === ffShadowInput), "collectFormControls collects inputs inside open shadow root", String(shadowControls.length));
  }

  global.document = savedGlobal;
  global.Event = savedEvent;
  global.MouseEvent = savedMouseEvent;
  global.PointerEvent = savedPointerEvent;
  global.window = savedWindow;
  global.computeAccessibleName = savedComputeName;
  global.computeRole = savedComputeRole;
  global.matchField = savedMatchField;

  // ── type tool: field parameter locates a snapshot element semantically ──
  const typeBridge = {
    executeAction: async (action) => {
      if (action.name !== "type") return { ok: false, error: "expected type" };
      return { ok: true, value: "typed " + action.target.name, action };
    },
  };
  const typeCtx = {
    snapshot: { elements: [
      { index: 0, role: "textbox", name: "用户名", placeholder: "请输入用户名" },
      { index: 1, role: "button", name: "登录" },
    ]},
    bridge: typeBridge,
  };
  const typeTool = registryMod.getTool("type");
  const tf1 = await typeTool.execute({ field: "username", text: "alice" }, typeCtx);
  assert(tf1.ok && tf1.action && tf1.action.target.name === "用户名", "type field=username resolves to 用户名 element");
  const tf2 = await typeTool.execute({ index: 1, field: "username", text: "x" }, typeCtx);
  assert(!tf2.ok, "type with both index and field fails");
  const tf3 = await typeTool.execute({ field: "nosuch", text: "x" }, typeCtx);
  assert(!tf3.ok, "type field not found fails");

  // ── resume: checkpoint carries notes; resume run restores them ──
  const notesCheckpoints = [];
  const notesBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "登录" }] }),
    executeAction: async (action) => ({ ok: true, value: `did ${action.name}` }),
  };
  const notesLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步a完成" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步b完成" })] }),
  ]);
  const notesSrc = await executorMod.execute(
    { goal: "g", steps: [{ description: "a" }, { description: "b" }] },
    {
      llm: notesLlm, bridge: notesBridge, memory: memoryMod.createMemory(),
      notes: notesMod.createNotes(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no replan"); },
      onCheckpoint: (cp) => notesCheckpoints.push(cp),
      maxTurns: 3, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(notesSrc.ok, "notes source run completes");
  const cp0 = notesCheckpoints[0];
  assert(cp0.notes && Object.keys(cp0.notes).length === 0, "empty notes omitted from checkpoint");
  notesLlm.notesMod = notesMod;
  const notesLlm2 = mockLlm([
    () => {
      // Agent uses memo on step b to prove the tool is reachable mid-run.
      if (!global._memoUsed) {
        global._memoUsed = true;
        return { content: "", toolCalls: [makeToolCall("memo", { mode: "set", key: "code", value: "1234" }), makeToolCall("finish", { summary: "步b完成" })] };
      }
      return { content: "", toolCalls: [makeToolCall("finish", { summary: "步b完成" })] };
    },
  ]);
  const notesResumed = await executorMod.execute(
    { goal: "g", steps: [{ description: "a" }, { description: "b" }] },
    {
      llm: notesLlm2, bridge: notesBridge, memory: memoryMod.createMemory(),
      notes: notesMod.createNotes({ code: "1234" }),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no replan"); },
      startStep: 1, maxTurns: 3, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(notesResumed.ok, "notes resume run completes");
  delete global._memoUsed;

  // ── resume: onCheckpoint emits progress, execute honors startStep ──
  const resumeBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "登录" }] }),
    executeAction: async (action) => ({ ok: true, value: `did ${action.name}` }),
  };
  const checkpoints = [];
  const resumeLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步a完成" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步b完成" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步b完成" })] }),
  ]);
  const resumeRun = await executorMod.execute(
    { goal: "g", steps: [{ description: "a" }, { description: "b" }] },
    {
      llm: resumeLlm, bridge: resumeBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no replan"); },
      onCheckpoint: (cp) => checkpoints.push(cp),
      maxTurns: 3, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(resumeRun.ok, "resume source run completes");
  assert(checkpoints.length >= 2, "onCheckpoint emitted after each step");
  assertEq(checkpoints[checkpoints.length - 1].nextStepIndex, 2, "final checkpoint points past the last step");
  const resumed = await executorMod.execute(
    checkpoints[0].plan, // plan object from the first checkpoint
    {
      llm: resumeLlm, bridge: resumeBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no replan"); },
      startStep: 1, // resume from step index 1
      maxTurns: 3, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(resumed.ok && resumed.summary === "步b完成", "resume run starts at startStep and finishes the remaining step");

  // ── resume: stop returns a resume token ──
  let stopNow = false;
  const stopBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "登录" }] }),
    executeAction: async () => ({ ok: true, value: "ok" }),
  };
  const stopLlm = mockLlm([
    () => { stopNow = true; return { content: "", toolCalls: [makeToolCall("finish", { summary: "步a" })] }; },
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "步b" })] }),
  ]);
  const stopRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "a" }, { description: "b" }, { description: "c" }] },
    {
      llm: stopLlm, bridge: stopBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no replan"); },
      startStep: 0, maxTurns: 3, maxStepRetries: 3, isStopped: () => stopNow,
    }
  );
  assert(!stopRes.ok && stopRes.resume, "stop returns a resume token");
  assertEq(stopRes.resume.nextStepIndex, 1, "resume token points to the next unrun step");

  // ── plan visualization: onProgress emits step lifecycle events ──
  const progEvents = [];
  const progLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "a" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "b" })] }),
  ]);
  const progRes = await executorMod.execute(
    { goal: "g", steps: [{ description: "步a" }, { description: "步b" }] },
    {
      llm: progLlm, bridge: resumeBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, replan: async () => { throw new Error("no replan"); },
      onProgress: (p) => progEvents.push(p),
      maxTurns: 3, maxStepRetries: 3, isStopped: () => false,
    }
  );
  assert(progRes.ok, "progress source run completes");
  assertEq(progEvents.filter((e) => e.status === "running").length, 2, "progress emits running per step");
  assertEq(progEvents.filter((e) => e.status === "done").length, 2, "progress emits done per completed step");
  assert(progEvents.every((e) => e.steps && e.steps.length === 2), "progress carries full step list");
  assertEq(progEvents[0].status, "running", "first progress event is running");
  assertEq(progEvents[0].description, "步a", "running event names the step");
  const doneFirst = progEvents.find((e) => e.status === "done");
  assertEq(doneFirst.currentIndex, 0, "done event marks step index 0");

  // progress after a failed step marks failed before replan
  const failProg = [];
  const failProgLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }),
  ]);
  await executorMod.execute(
    { goal: "g", steps: [{ description: "z" }] },
    {
      llm: failProgLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onProgress: (p) => failProg.push(p),
      maxTurns: 2, maxStepRetries: 1, maxReplans: 1, isStopped: () => false,
    }
  );
  assert(failProg.some((e) => e.status === "failed"), "progress emits failed on step failure");

  // ── maxTurns exhaustion: 步骤耗尽 turn 无进展，必须带可诊断 errorCode，
  //    供 replan 注入针对性引导（否则 replan 无引导重试同一路径 → 反复重规划）──
  const turnsExhaustLlm = mockLlm(Array.from({ length: 10 }, () =>
    () => ({ content: "看看页面", toolCalls: [makeToolCall("wait", { ms: 10 })] })  // 永远不 finish
  ));
  const turnsExhaustRes = await executorMod.executeStep(
    { description: "多步无进展步骤" },
    {
      llm: turnsExhaustLlm, bridge: execBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, maxTurns: 3, maxRecoveryAttempts: 1, isStopped: () => false,
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "多步无进展步骤" }] }, goal: "g",
    }
  );
  assert(!turnsExhaustRes.ok, "maxTurns exhaustion fails the step");
  assertEq(turnsExhaustRes.errorCode, "STEP_TURNS_EXHAUSTED", "maxTurns exhaustion carries a diagnostic errorCode");

  // replan 收到该 errorCode 时应提供针对"无进展反复重试"的引导
  const guidanceForTurns = plannerMod.replanGuidance("STEP_TURNS_EXHAUSTED");
  assert(guidanceForTurns.length > 0, "replan guidance exists for STEP_TURNS_EXHAUSTED");
  assert(guidanceForTurns.includes("没有进展"), "STEP_TURNS_EXHAUSTED guidance tells the model to stop retrying without progress");

  // ── vision fallback ──
  const visionMod = require("../sidepanel/vision.js");
  const vp = visionMod.buildVisionPrompt("登录按钮");
  assert(vp.includes("登录按钮"), "vision prompt embeds target description");
  assert(visionMod.parseVisionAnswer("在页面顶部，登录按钮可见").visible, "vision parses visible target");
  assert(!visionMod.parseVisionAnswer("未找到，目标不可见").visible, "vision parses invisible target");
  assert(!visionMod.parseVisionAnswer("被弹窗遮挡").visible, "vision parses occlusion");
  const vBridge = {
    capture: async () => "data:image/png;base64,AAAA",
  };
  const vLlm = { generate: async (msgs, opts) => { assert(opts.images && opts.images.length === 1, "vision passes screenshot to llm"); return { content: "登录按钮在页面中部，可见" }; } };
  const vRes = await visionMod.runVisionFallback({ bridge: vBridge, llm: vLlm, targetDesc: "登录按钮" });
  assert(vRes.ok && vRes.visible && vRes.imageUsed, "vision fallback succeeds with screenshot");
  const vNoCap = await visionMod.runVisionFallback({ bridge: { capture: async () => null }, llm: vLlm, targetDesc: "x" });
  assert(!vNoCap.ok, "vision fallback degrades when capture unavailable");
  const vErr = await visionMod.runVisionFallback({ bridge: { capture: async () => { throw new Error("perm"); } }, llm: vLlm, targetDesc: "x" });
  assert(!vErr.ok && vErr.reason.includes("perm"), "vision fallback degrades on capture error");

  // policy gains vision_locate last resort only when enabled
  const policyMod = require("../sidepanel/recovery-policy.js");
  assert(!policyMod.getAllowedActions("ELEMENT_NOT_FOUND", policyMod.DEFAULT_RECOVERY_POLICY).some((a) => a.action === "vision_locate"), "default policy has no vision");
  const vpPolicy = policyMod.withVisionFallback();
  const vpActions = policyMod.getAllowedActions("ELEMENT_NOT_FOUND", vpPolicy);
  assert(vpActions.some((a) => a.action === "vision_locate"), "withVisionFallback appends vision_locate");
  const vpFinish = vpActions.findIndex((a) => a.action === "finish");
  const vpVision = vpActions.findIndex((a) => a.action === "vision_locate");
  assert(vpVision > -1 && vpVision < vpFinish, "vision_locate sits above finish (last resort before giving up)");

// executor runs vision_locate as last resort when enabled: DOM retries exhaust, then vision
const visionEvents = [];
const visionLlm = mockLlm([
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn1 → recover wait_and_retry
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn2 → recover retry_snapshot
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn3 → recover dismiss_modal
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn4 → recover scroll_and_retry
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn5 → recover retry_snapshot
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn6 → recover vision_locate
  () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }), // turn7 → succeed
]);
  const visionBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "存在" }] }),
    executeAction: async (a) => ({ ok: true, value: "did " + a.name }),
    capture: async () => "data:image/png;base64,AAAA",
  };
  const visionRuntimeLlm = { generate: async (msgs, opts) => ({ content: "目标元素在页面中部，可见" }) };
  const vExec = await executorMod.executeStep(
    { description: "点不存在元素" },
    {
      llm: visionLlm, bridge: visionBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => visionEvents.push(ev),
      enableVision: true, history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点不存在元素" }] }, goal: "g",
      maxTurns: 8, maxRecoveryAttempts: 2, isStopped: () => false,
      visionLlm: visionRuntimeLlm, // injected for the vision pass
    }
  );
  assert(vExec.ok && vExec.summary === "ok", "enabled vision recovery lets the step succeed");
  assert(visionEvents.some((e) => e.action === "vision_locate"), "vision_locate recovery event emitted");

  // ── dismiss_modal recovery：ELEMENT_NOT_FOUND 恢复序列含 dismiss_modal，
  //    会调 content 的 dismissModal action（关弹窗）──
  const dmCalls = [];
  const dmBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "存在" }] }),
    executeAction: async (a) => { if (a.name === "dismissModal") dmCalls.push(a); return { ok: true, value: "did " + a.name }; },
  };
  const dmLlm = mockLlm(Array.from({ length: 6 }, () =>
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] })  // 永远失败，触发恢复链
  ));
  const dmEvents = [];
  const dmExec = await executorMod.executeStep(
    { description: "点被弹窗遮挡的元素" },
    {
      llm: dmLlm, bridge: dmBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => dmEvents.push(ev),
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点被弹窗遮挡的元素" }] }, goal: "g",
      maxTurns: 8, maxRecoveryAttempts: 4, isStopped: () => false,
    }
  );
  assert(dmCalls.length === 1, "dismiss_modal calls the content dismissModal action once");
  assert(dmEvents.some((e) => e.kind === "attempt" && e.action === "dismiss_modal"), "recovery emits dismiss_modal attempt");
  assert(!dmExec.ok, "endless failure still fails the step after recoveries");

  // vision disabled: never selects vision_locate, step still fails after DOM exhaustion
  const noVisionEvents = [];
  const noVisionLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }),
  ]);
  const nvExec = await executorMod.executeStep(
    { description: "点不存在元素" },
    {
      llm: noVisionLlm, bridge: visionBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => noVisionEvents.push(ev),
      enableVision: false, history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点不存在元素" }] }, goal: "g",
      maxTurns: 6, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(!nvExec.ok, "vision disabled still fails the step");
  assert(!noVisionEvents.some((e) => e.action === "vision_locate"), "vision_locate never runs when disabled");

  // ── vision coordinates: parse "x:n, y:n" and drive click_at ──
  const parsedCoord = visionMod.parseVisionAnswer("目标在页面中部。x:512, y:360");
  assert(parsedCoord.visible && parsedCoord.x === 512 && parsedCoord.y === 360 && parsedCoord.hasCoordinates, "vision parses coordinates");
  const parsedNoCoord = visionMod.parseVisionAnswer("目标可见，无法确定坐标");
  assert(!parsedNoCoord.hasCoordinates, "vision reports no coordinates when absent");
  const parsedInvisible = visionMod.parseVisionAnswer("不可见，需要滚动");
  assert(!parsedInvisible.visible && !parsedInvisible.hasCoordinates, "invisible answer yields no coordinates");
  // A model that gives coordinates has clearly SEEN the element; incidental
  // "遮挡/不可见" wording must not override the coordinate signal.
  const coordsWin = visionMod.parseVisionAnswer("目标被部分遮挡，不过我可以看到它。x:400, y:300");
  assert(coordsWin.visible && coordsWin.x === 400 && coordsWin.y === 300, "coordinate pair overrides incidental occlusion wording");

  // ── click_at tool round-trips through the registry ──
  const atCalls = [];
  const atBridge = { executeAction: async (a) => { atCalls.push(a); return { ok: true, value: "clicked at " + a.args.x + "," + a.args.y }; } };
  const atTool = registryMod.getTool("click_at");
  assert(atTool, "click_at tool registered");
  const atRes = await atTool.execute({ x: 100, y: 200 }, { bridge: atBridge });
  assert(atRes.ok && atRes.value.includes("100,200"), "click_at executes with coordinates");
  assert(atCalls[0].name === "clickAt" && atCalls[0].args.x === 100, "click_at sends clickAt action");
  const atBad = await atTool.execute({}, { bridge: atBridge });
  assert(!atBad.ok, "click_at rejects missing coordinates");

  // ── vision recovery with coordinates hands the agent a click_at hint ──
  const coordEvents = [];
const coordLlm = mockLlm([
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn1 → recover wait_and_retry
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn2 → recover retry_snapshot
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn3 → recover dismiss_modal
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn4 → recover scroll_and_retry
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn5 → recover retry_snapshot
  () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn6 → recover vision_locate (has coords)
  () => ({ content: "", toolCalls: [makeToolCall("click_at", { x: 512, y: 360 })] }), // turn7 → agent clicks at coords
  () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "点了" })] }), // turn8 → done
]);
  const coordVisionLlm = { generate: async (msgs, opts) => ({ content: "目标可见。x:512, y:360" }) };
  const coordBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "存在" }] }),
    executeAction: async (a) => ({ ok: true, value: "did " + a.name }),
    capture: async () => "data:image/png;base64,AAAA",
  };
  const coordExec = await executorMod.executeStep(
    { description: "点不存在元素" },
    {
      llm: coordLlm, bridge: coordBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => coordEvents.push(ev),
      enableVision: true, history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点不存在元素" }] }, goal: "g",
      maxTurns: 8, maxRecoveryAttempts: 2, isStopped: () => false,
      visionLlm: coordVisionLlm,
    }
  );
  assert(coordExec.ok && coordExec.summary === "点了", "vision coordinates + click_at complete the step");
  assert(coordEvents.some((e) => e.action === "vision_locate" && /512, 360/.test(e.reason || "")), "vision_locate event carries coordinates");

  // ── duplicate-click guard ──
  // An agent that tries to click the same target twice with no intervening action
  // must have the second click short-circuited (prevents double-submits).
  const clickCalls = [];
  const dupBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "send" }] }),
    executeAction: async (a) => { clickCalls.push(a.name); return { ok: true, value: "did " + a.name }; },
  };
  const dupLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 }), makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const dupExec = await executorMod.executeStep(
    { description: "点发送" },
    {
      llm: dupLlm, bridge: dupBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: () => {},
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点发送" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(dupExec.ok, "duplicate-click guard still completes the step");
  assertEq(clickCalls.filter((n) => n === "click").length, 1, "duplicate click short-circuited");

  // A click separated from the previous one ONLY by a passive tool (wait) is
  // still a duplicate — wait does not change page state, so the guard stays
  // armed and the second click is short-circuited (prevents triple-sends where
  // the agent interleaves waits between identical send clicks).
  const clickCalls2 = [];
  const dupBridge2 = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "send" }] }),
    executeAction: async (a) => { clickCalls2.push(a.name); return { ok: true, value: "did " + a.name }; },
  };
  const dupLlm2 = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 }), makeToolCall("wait", { ms: 500 }), makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const dupExec2 = await executorMod.executeStep(
    { description: "点发送两次" },
    {
      llm: dupLlm2, bridge: dupBridge2, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: () => {},
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点发送两次" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(dupExec2.ok, "wait-interleaved clicks still complete");
  assertEq(clickCalls2.filter((n) => n === "click").length, 1, "wait does not clear the duplicate guard (second click short-circuited)");

  // A re-render changes the button's INDEX but not its NAME (new message inserted
  // above it on a chat page). The guard must still fire using the stable name.
  // Modeled as two turns: after the first click the snapshot refreshes with the
  // button at a different index but the same name. Element arrays are indexed
  // consistently with their `index` field (as in real snapshots).
  const sendBtn = (i) => ({ index: i, role: "button", name: "图标按钮(输入框下右)" });
  let btnIndex = 3;
  const shiftCalls = [];
  const dupBridgeShift = {
    snapshot: async () => {
      const arr = [];
      for (let k = 0; k <= btnIndex; k++) arr.push({ index: k, role: k === btnIndex ? "button" : "img", name: k === btnIndex ? "图标按钮(输入框下右)" : "image" + k });
      return { url: "u", title: "t", elements: arr };
    },
    executeAction: async (a) => { shiftCalls.push(a.name); return { ok: true, value: "did " + a.name }; },
  };
  const dupLlmShift = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 3 })] }),
    () => {
      // Turn 2: the snapshot has already refreshed — the button's index moved
      // from 3 to 7 (new content above it), name unchanged.
      btnIndex = 7;
      return { content: "", toolCalls: [makeToolCall("click", { index: 7 })] };
    },
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const dupExecShift = await executorMod.executeStep(
    { description: "点发送" },
    {
      llm: dupLlmShift, bridge: dupBridgeShift, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: () => {},
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点发送" }] }, goal: "g",
      maxTurns: 4, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(dupExecShift.ok, "re-render (index shift) step still completes");
  assertEq(shiftCalls.filter((n) => n === "click").length, 1, "duplicate guard fires across index shift via stable name");

  // ── click_at spam guard: same coords + no page change → CLICK_AT_UNVERIFIED ──
  const spamLogs = [];
  const spamRecovery = [];
  const spamBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "b" }] }),
    executeAction: async (a) => ({ ok: true, value: "did " + a.name }),
  };
  const spamLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click_at", { x: 100, y: 470 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click_at", { x: 100, y: 470 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }),
  ]);
  const spamExec = await executorMod.executeStep(
    { description: "点目标" },
    {
      llm: spamLlm, bridge: spamBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: (t, x) => spamLogs.push([t, x]), onRecovery: (ev) => spamRecovery.push(ev),
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点目标" }] }, goal: "g",
      maxTurns: 4, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(spamLogs.some(([t, x]) => t === "tool" && x.includes("盲试拦截")), "click_at spam guard flags repeated same-coordinate clicks");
  assert(spamRecovery.some((e) => e.code === "CLICK_AT_UNVERIFIED"), "spam guard flows to recovery with CLICK_AT_UNVERIFIED");

  // click_at guard also flags DIFFERENT coordinates when the page is unchanged
  // (agent switching guessed pixels against the same static page is blind too).
  const spamLogs2 = [];
  const spamRecovery2 = [];
  const spam2Bridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [{ index: 0, role: "button", name: "b" }] }),
    executeAction: async (a) => ({ ok: true, value: "did " + a.name }),
  };
  const spam2Llm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click_at", { x: 375, y: 820 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("click_at", { x: 470, y: 840 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }),
  ]);
  const spam2Exec = await executorMod.executeStep(
    { description: "点目标" },
    {
      llm: spam2Llm, bridge: spam2Bridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: (t, x) => spamLogs2.push([t, x]), onRecovery: (ev) => spamRecovery2.push(ev),
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点目标" }] }, goal: "g",
      maxTurns: 4, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(spamLogs2.some(([t, x]) => t === "tool" && x.includes("盲试拦截")), "click_at guard flags changed-coordinate clicks on an unchanged page");
  assert(spamRecovery2.some((e) => e.code === "CLICK_AT_UNVERIFIED"), "changed-coordinate blind clicks flow to recovery");

  // ── find_by_vision tool: sight-based location for snapshot-missing targets ──
  const fbvTool = registryMod.getTool("find_by_vision");
  assert(fbvTool, "find_by_vision tool registered");
  const fbvVision = { generate: async (msgs, opts) => ({ content: "目标可见。x:320, y:240" }) };
  const fbvBridge = { capture: async () => "data:image/png;base64,AAAA" };
  const fbvOk = await fbvTool.execute({ target: "红框的视觉兜底目标" }, { bridge: fbvBridge, llm: fbvVision, enableVision: true });
  assert(fbvOk.ok && fbvOk.value.x === 320 && fbvOk.value.y === 240, "find_by_vision returns coordinates");
  const fbvHidden = await fbvTool.execute({ target: "不存在的东西" }, { bridge: fbvBridge, llm: { generate: async () => ({ content: "不可见，页面上没有" }) }, enableVision: true });
  assert(!fbvHidden.ok && fbvHidden.errorCode === "VISION_TARGET_HIDDEN", "find_by_vision reports hidden target");
  const fbvNoCap = await fbvTool.execute({ target: "x" }, { bridge: {}, llm: fbvVision, enableVision: true });
  assert(!fbvNoCap.ok && fbvNoCap.errorCode === "VISION_UNAVAILABLE", "find_by_vision requires capture bridge");
  const fbvNoLlm = await fbvTool.execute({ target: "x" }, { bridge: fbvBridge, llm: null, enableVision: true });
  assert(!fbvNoLlm.ok && fbvNoLlm.errorCode === "VISION_UNAVAILABLE", "find_by_vision reports unconfigured vision");
  const fbvNoTarget = await fbvTool.execute({}, { bridge: fbvBridge, llm: fbvVision, enableVision: true });
  assert(!fbvNoTarget.ok, "find_by_vision requires target description");
  const fbvDisabled = await fbvTool.execute({ target: "x" }, { bridge: fbvBridge, llm: fbvVision, enableVision: false });
  assert(!fbvDisabled.ok && fbvDisabled.errorCode === "VISION_UNAVAILABLE", "find_by_vision requires vision enabled");

  // A state-changing action (paste) between two clicks DOES clear the guard, so
  // a later distinct click on the same target is allowed.
  const clickCalls3 = [];
  const dupBridge3 = {
    snapshot: async () => ({ url: "u", title: "t", elements: [
      { index: 0, role: "button", name: "send" },
      { index: 1, role: "textbox", name: "输入框" },
    ] }),
    executeAction: async (a) => { clickCalls3.push(a.name); return { ok: true, value: "did " + a.name }; },
  };
  const dupLlm3 = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 0 }), makeToolCall("paste", { index: 1, text: "hi" }), makeToolCall("click", { index: 0 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const dupExec3 = await executorMod.executeStep(
    { description: "点发送两次" },
    {
      llm: dupLlm3, bridge: dupBridge3, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: () => {},
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "点发送两次" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(dupExec3.ok, "clicks separated by a state-changing action complete");
  assertEq(clickCalls3.filter((n) => n === "click").length, 2, "state-changing action clears the guard (both clicks execute)");

  // ── send verification loop ──
  // A send click whose input is NOT cleared (message never sent) must be flagged
  // SEND_NOT_VERIFIED and flow through recovery instead of silently "succeeding".
  let sendCleared = false;
  const sendSnap = () => ({ url: "u", title: "t", elements: [
    { index: 0, role: "textbox", name: "输入框", value: sendCleared ? "" : "hello" },
    { index: 1, role: "button", name: "图标按钮(输入框右下)" },
  ] });
  const sendEvents = [];
  const sendBridge = {
    snapshot: async () => sendSnap(),
    executeAction: async (a) => {
      if (a.name === "click") sendCleared = true; // send clears the input
      return { ok: true, value: "did " + a.name };
    },
    capture: async () => "data:image/png;base64,AAAA",
  };
  const sendLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("type", { index: 0, text: "hello" }), makeToolCall("click", { index: 1 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const sendExec = await executorMod.executeStep(
    { description: "输入并发送" },
    {
      llm: sendLlm, bridge: sendBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => sendEvents.push(ev),
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "输入并发送" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(sendExec.ok, "verified send completes the step");
  assert(sendEvents.some((e) => e.action === "wait_and_retry") === false, "no recovery needed when send verified");

  // Send that does NOT clear the input (editor-state desync) → SEND_NOT_VERIFIED recovery.
  const sendFailEvents = [];
  const sendFailBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [
      { index: 0, role: "textbox", name: "输入框", value: "hello" },
      { index: 1, role: "button", name: "图标按钮(输入框右下)" },
    ] }),
    executeAction: async (a) => ({ ok: true, value: "did " + a.name }), // click never clears input
    capture: async () => "data:image/png;base64,AAAA",
  };
  const sendFailLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("type", { index: 0, text: "hello" }), makeToolCall("click", { index: 1 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "sent anyway" })] }),
  ]);
  const sendFailExec = await executorMod.executeStep(
    { description: "输入并发送" },
    {
      llm: sendFailLlm, bridge: sendFailBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => sendFailEvents.push(ev),
      enableVision: false, history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "输入并发送" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(sendFailEvents.some((e) => e.action === "wait_and_retry"), "unverified send triggers recovery");
  assert(!sendFailExec.ok || sendFailEvents.some((e) => e.action === "wait_and_retry"), "unverified send does not silently succeed");

  // paste also arms the send verification (a paste→send flow is the common chat pattern).
  const pasteSendEvents = [];
  let pasteSendCleared = false;
  const pasteSendBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [
      { index: 0, role: "textbox", name: "输入框", value: pasteSendCleared ? "" : "长文本" },
      { index: 1, role: "button", name: "图标按钮(输入框右下)" },
    ] }),
    executeAction: async (a) => {
      if (a.name === "click") pasteSendCleared = true;
      return { ok: true, value: "did " + a.name };
    },
    capture: async () => "data:image/png;base64,AAAA",
  };
  const pasteSendLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("paste", { index: 0, text: "长文本" }), makeToolCall("click", { index: 1 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const pasteSendExec = await executorMod.executeStep(
    { description: "粘贴并发送" },
    {
      llm: pasteSendLlm, bridge: pasteSendBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => pasteSendEvents.push(ev),
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "粘贴并发送" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(pasteSendExec.ok, "paste+send verified completes the step");
  assert(!pasteSendEvents.some((e) => e.action === "wait_and_retry"), "paste-armed send verification runs (no recovery when verified)");

  // Send verification falls back to vision confirm when enabled and DOM is ambiguous.
  const visEvents = [];
  const visBridge = {
    snapshot: async () => ({ url: "u", title: "t", elements: [
      { index: 0, role: "textbox", name: "输入框", value: "hello" },
      { index: 1, role: "button", name: "图标按钮(输入框右下)" },
    ] }),
    executeAction: async (a) => ({ ok: true, value: "did " + a.name }),
    capture: async () => "data:image/png;base64,AAAA",
  };
  const visConfirmLlm = { generate: async (msgs, opts) => ({ content: "已发送，输入框已清空" }) };
  const visLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("type", { index: 0, text: "hello" }), makeToolCall("click", { index: 1 })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }),
  ]);
  const visExec = await executorMod.executeStep(
    { description: "输入并发送" },
    {
      llm: visLlm, bridge: visBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, onRecovery: (ev) => visEvents.push(ev),
      enableVision: true, visionLlm: visConfirmLlm,
      history: [{ role: "system", content: "" }],
      plan: { goal: "g", steps: [{ description: "输入并发送" }] }, goal: "g",
      maxTurns: 3, maxRecoveryAttempts: 2, isStopped: () => false,
    }
  );
  assert(visExec.ok, "vision-confirmed send completes the step");
  assert(!visEvents.some((e) => e.action === "wait_and_retry"), "vision-confirmed send needs no recovery");

  // ── parseSendConfirm unit checks ──
  const visionMod2 = require("../sidepanel/vision.js");
  assert(visionMod2.parseSendConfirm("已发送，消息发出去了").sent, "parseSendConfirm detects sent");
  assert(!visionMod2.parseSendConfirm("未发送，输入框仍有文字").sent, "parseSendConfirm detects not-sent");
  assert(visionMod2.buildSendConfirmPrompt().includes("已发送"), "send-confirm prompt asks for sent/not-sent");

  // ── read_captcha tool ──
  const captchaTool = registryMod.getTool("read_captcha");
  assert(!!captchaTool, "read_captcha tool registered");
  const captchaOk = await captchaTool.execute({}, {
    bridge: { capture: async () => "data:image/png;base64,AAA" },
    llm: { generate: async (msgs, opts) => { assert(!!opts && opts.images && opts.images[0] === "data:image/png;base64,AAA", "read_captcha passes screenshot to llm"); return { content: "3K9f" }; } },
  });
  assert(captchaOk.ok && captchaOk.value === "3K9f", "read_captcha returns captcha chars");
  const captchaFail = await captchaTool.execute({}, {
    bridge: { capture: async () => "data:image/png;base64,AAA" },
    llm: { generate: async () => ({ content: "UNREADABLE" }) },
  });
  assert(!captchaFail.ok, "read_captcha reports unreadable");
  const captchaNoCap = await captchaTool.execute({}, { bridge: { capture: async () => "data:image/png;base64,AAA" } });
  assert(!captchaNoCap.ok && /llm/.test(captchaNoCap.error), "read_captcha fails without llm");
  const captchaNoShot = await captchaTool.execute({}, { llm: { generate: async () => ({ content: "1234" }) }, bridge: { capture: async () => null } });
  assert(!captchaNoShot.ok && /capture/.test(captchaNoShot.error), "read_captcha fails without capture");

  // captureCanvas (exact bitmap) takes priority over the full-page screenshot.
  const captchaBit = await captchaTool.execute({ index: 3 }, {
    bridge: {
      captureCanvas: async (t) => { assert(t && t.cssPath, "read_captcha passes element locator to captureCanvas"); return "data:image/png;base64,BBB"; },
      capture: async () => "data:image/png;base64,AAA",
    },
    snapshot: { elements: [{ index: 3, role: "generic", name: "验证码(captcha)", cssPath: "#captcha", frameId: 0 }] },
    llm: { generate: async (msgs, opts) => { assert(opts.images[0] === "data:image/png;base64,BBB", "captureCanvas bitmap used over screenshot"); return { content: "8B9K" }; } },
  });
  assert(captchaBit.ok && captchaBit.value === "8B9K", "read_captcha uses exact captcha bitmap");

  // A 5-char result (visual model read noise as a digit) must be rejected.
  const captcha5 = await captchaTool.execute({}, {
    bridge: { capture: async () => "data:image/png;base64,AAA" },
    llm: { generate: async () => ({ content: "4y97B" }) },
  });
  assert(!captcha5.ok, "5-char captcha read rejected");

  // ── page-risk detection (captcha / removed / rate-limit walls) ──
  const riskDetect = executorMod.detectPageRisk;
  assert(riskDetect({ url: "https://www.google.com/recaptcha/api2/anchor", title: "Human Verification" }) != null, "detects recaptcha url");
  assert(riskDetect({ url: "https://x.com/signup", title: "Verify you are human" }) != null, "detects human-verification title");
  assert(riskDetect({ url: "https://www.reddit.com/r/x/comments/abc/", title: "This post was removed by moderator" }) != null, "detects removed post");
  assert(riskDetect({ url: "https://www.reddit.com/r/x/comments/abc/", title: "帖子已被删除" }) != null, "detects removed post (zh)");
  assert(riskDetect({ url: "https://api.reddit.com/", title: "Too Many Requests - Slow down" }) != null, "detects rate limit");
  assert(riskDetect({ url: "https://www.reddit.com/r/AI_Agents/", title: "AI Agents" }) == null, "normal page not flagged");
  assert(riskDetect({ url: "https://www.reddit.com/mod/chrome_extensions/rules/", title: "Mod tools" }) != null, "moderator tools page flagged as risky");
  assert(riskDetect({ url: "https://www.reddit.com/r/chrome_extensions/about/rules/", title: "rules" }) == null, "public about/rules page not flagged");
  // Narrow the deleted-resource heuristic: a normal page whose path merely
  // contains 'deleted' must NOT be flagged (w3schools/example pages were
  // false-positive'd by the old /removed|deleted/ + /.com/ rule).
  assert(riskDetect({ url: "https://www.w3schools.com/html/html_iframe.asp", title: "HTML Tutorial" }) == null, "normal .com page not flagged");
  assert(riskDetect({ url: "https://example.com/items/deleted-items/", title: "Items" }) == null, "path containing 'deleted' but not a delete page not flagged");
  assert(riskDetect({ url: "https://www.reddit.com/r/x/comments/abc/removed", title: "Post" }) != null, "removed path still flagged");
  assert(riskDetect(null) == null, "null snapshot not flagged");

  // PAGE_RISK_STOP: 3 consecutive rounds on a risky page stop the step.
  const riskLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("navigate", { url: "https://example.com/" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("navigate", { url: "https://example.com/" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("navigate", { url: "https://example.com/" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("navigate", { url: "https://example.com/" })] }),
  ]);
  const riskRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: riskLlm,
      bridge: { snapshot: async () => ({ url: "https://www.google.com/recaptcha/api2/anchor", title: "Human Verification", elements: [] }), executeAction: async () => ({ ok: true }) },
      memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 6, maxRecoveryAttempts: 2,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(!riskRes.ok && riskRes.errorCode === "PAGE_RISK_STOP", "3 rounds on captcha page stops the step with PAGE_RISK_STOP");

  // A risky leftover tab (e.g. /mod/ page) is escapable: agent navigates to a
  // clean page and the step proceeds instead of hard-failing immediately.
  let riskyFirst = true;
  const escapeBridge = {
    snapshot: async () => {
      if (riskyFirst) return { url: "https://www.reddit.com/mod/chrome_extensions/rules/", title: "Mod tools", elements: [] };
      return { url: "https://www.reddit.com/r/AI_Agents/", title: "AI Agents", elements: [{ index: 0, role: "button", name: "x" }] };
    },
    executeAction: async (a) => { if (a.name === "navigate" || a.name === "tab") riskyFirst = false; return { ok: true, value: "did " + a.name }; },
  };
  const escapeLlm = mockLlm([
    () => ({ content: "", toolCalls: [makeToolCall("navigate", { url: "https://www.reddit.com/r/AI_Agents/" })] }),
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }),
  ]);
  const escapeRes = await executorMod.executeStep(
    { description: "t" },
    {
      llm: escapeLlm, bridge: escapeBridge, memory: memoryMod.createMemory(),
      getTool: registryMod.getTool, getToolsSchema: registryMod.getToolsSchema,
      onLog: () => {}, isStopped: () => false, maxTurns: 5, maxRecoveryAttempts: 2,
      history: [{ role: "system", content: "" }], plan: { goal: "g", steps: [{ description: "t" }] }, goal: "g",
    }
  );
  assert(escapeRes.ok, "agent escapes a risky tab by navigating and the step completes");

  // ── task suggestions (common/suggest.js) ──
  const mkEl = (o) => Object.assign({
    index: 0, role: "generic", name: "", inputType: "", placeholder: "",
    value: "", tag: "", href: "", text: "", disabled: false,
  }, o);
  const mkSnap = (title, elems) => ({ url: "https://example.com/", title, elements: elems });

  // Search form: a "搜索" input + submit button → search suggestion.
  let sug = suggestMod.suggestTasks(mkSnap("首页", [
    mkEl({ role: "textbox", name: "搜索", placeholder: "请输入关键词" }),
    mkEl({ role: "button", name: "搜索" }),
  ]));
  assert(sug.some((t) => t.id === "search"), "search box + button suggests a search task");

  // Login form: password input detected via inputType.
  sug = suggestMod.suggestTasks(mkSnap("登录", [
    mkEl({ role: "textbox", name: "账号", inputType: "text" }),
    mkEl({ role: "textbox", name: "密码", inputType: "password" }),
    mkEl({ role: "button", name: "登录" }),
  ]));
  assert(sug.some((t) => t.id === "login"), "password input suggests a login task");
  assert(!sug.some((t) => t.id === "search"), "login page does not also suggest search");

  // Many links → extract-links suggestion.
  sug = suggestMod.suggestTasks(mkSnap("目录", Array.from({ length: 12 }, (_, i) =>
    mkEl({ role: "link", name: "链接" + i, href: "https://example.com/" + i })
  )));
  assert(sug.some((t) => t.id === "extract-links"), "12 links suggest extract-links");

  // Table elements → extract-table suggestion.
  sug = suggestMod.suggestTasks(mkSnap("报表", [
    mkEl({ role: "table", tag: "table" }),
    mkEl({ role: "cell", tag: "td" }),
  ]));
  assert(sug.some((t) => t.id === "extract-table"), "table elements suggest extract-table");

  // 下一页/加载更多 → crawl-pages suggestion.
  sug = suggestMod.suggestTasks(mkSnap("列表", [
    mkEl({ role: "link", name: "下一页", href: "https://example.com/2" }),
  ]));
  assert(sug.some((t) => t.id === "crawl-pages"), "next-page link suggests crawl-pages");

  // Every non-empty page gets a generic extract-text task, deduped.
  sug = suggestMod.suggestTasks(mkSnap("任意", [
    mkEl({ role: "textbox", name: "搜索", placeholder: "q" }),
    mkEl({ role: "button", name: "搜索" }),
  ]));
  assert(sug.some((t) => t.id === "extract-text"), "always offers extract-text");
  assert(sug.length === new Set(sug.map((t) => t.goal)).size, "suggestions dedupe by goal");
  assert(suggestMod.suggestTasks(mkSnap("空", [])).length === 0, "empty page yields no suggestions");

  // Password detection falls back to name/placeholder hints (no inputType).
  assert(suggestMod.findLoginFields([mkEl({ role: "textbox", name: "用户名" }), mkEl({ role: "textbox", name: "密码" })]), "password hint detected by name");

  // ── task memory (common/task-memory.js) ──
  assertEq(taskMemoryMod.extractDomain("https://www.example.com/path?a=1"), "www.example.com", "extractDomain parses hostname");
  assertEq(taskMemoryMod.extractDomain("http://localhost:8080/x"), "localhost", "extractDomain keeps portless host");
  assertEq(taskMemoryMod.extractDomain(""), "", "extractDomain empty input");
  assertEq(taskMemoryMod.extractDomain("not a url"), "not", "extractDomain falls back to regex for odd input");
  const mem0 = taskMemoryMod.recordGoalInMemory({}, "a.com", "  搜索并打开第一条结果  ");
  assert(mem0["a.com"] && mem0["a.com"].length === 1, "recordGoalInMemory adds first goal");
  assertEq(mem0["a.com"][0].goal, "搜索并打开第一条结果", "recordGoalInMemory trims goal");
  assertEq(mem0["a.com"][0].count, 1, "recordGoalInMemory starts count at 1");
  const mem1 = taskMemoryMod.recordGoalInMemory(mem0, "a.com", "搜索并打开第一条结果");
  assertEq(mem1["a.com"][0].count, 2, "recordGoalInMemory increments repeated goal");
  assertEq(mem1["a.com"].length, 1, "recordGoalInMemory dedupes repeated goal");
  const mem2 = taskMemoryMod.recordGoalInMemory(mem1, "a.com", "比价");
  assertEq(mem2["a.com"].length, 2, "recordGoalInMemory keeps distinct goals");
  assertEq(mem2["a.com"][0].goal, "搜索并打开第一条结果", "recordGoalInMemory sorts by count desc");
  const mem3 = taskMemoryMod.recordGoalInMemory(mem2, "b.com", "跨站搬运");
  assert(mem3["b.com"] && mem3["b.com"].length === 1, "recordGoalInMemory stores second domain");
  assert(mem2["b.com"] === undefined, "recordGoalInMemory is immutable to the caller");
  // Per-domain cap: only the most-frequent 20 goals survive.
  let memCap = {};
  for (let i = 0; i < 25; i++) memCap = taskMemoryMod.recordGoalInMemory(memCap, "c.com", "任务" + i);
  assertEq(memCap["c.com"].length, taskMemoryMod.MAX_PER_DOMAIN, "per-domain cap at MAX_PER_DOMAIN");
  // Global cap: total entries bounded by MAX_TOTAL.
  let memTot = {};
  for (let d = 0; d < 12; d++) {
    for (let i = 0; i < 25; i++) memTot = taskMemoryMod.recordGoalInMemory(memTot, "d" + d + ".com", "g" + i);
  }
  let total = 0;
  for (const d of Object.keys(memTot)) total += memTot[d].length;
  assert(total <= taskMemoryMod.MAX_TOTAL, "global memory bounded by MAX_TOTAL");
  // getDomainGoals returns sorted copy without mutating.
  const goals = taskMemoryMod.getDomainGoals(mem3, "a.com");
  assertEq(goals[0].goal, "搜索并打开第一条结果", "getDomainGoals returns count-desc order");
  const goals2 = taskMemoryMod.getDomainGoals(mem3, "a.com");
  assertEq(goals2[0].goal, goals[0].goal, "getDomainGoals is repeatable");
  assertEq(taskMemoryMod.getDomainGoals(mem3, "nope.com").length, 0, "getDomainGoals empty for unknown domain");
  // normalizeMemory coerces junk payloads.
  const normMem = taskMemoryMod.normalizeMemory({ "a.com": [{ goal: "x", count: "3", lastAt: 1 }, { goal: "" }, null, "junk"] });
  assertEq(normMem["a.com"].length, 1, "normalizeMemory drops empty/invalid entries");
  assertEq(normMem["a.com"][0].count, 3, "normalizeMemory coerces count");
  assertEq(taskMemoryMod.normalizeMemory(null)["a.com"], undefined, "normalizeMemory handles null");
  assertEq(taskMemoryMod.normalizeMemory({ "a.com": "nope" })["a.com"], undefined, "normalizeMemory drops non-array domain");
  // mergeSuggestions pins memory on top, dedupes by goal, respects limit.
  const heur = suggestMod.suggestTasks(mkSnap("首页", [
    mkEl({ role: "textbox", name: "搜索" }),
    mkEl({ role: "button", name: "搜索" }),
  ]));
  const merged = taskMemoryMod.mergeSuggestions(
    [{ goal: "搜索并打开第一条结果", count: 3 }, { goal: "比价", count: 1 }],
    heur,
    6
  );
  assertEq(merged[0].goal, "搜索并打开第一条结果", "mergeSuggestions pins memory first");
  assert(merged[0].frequent, "mergeSuggestions marks memory entry as frequent");
  assertEq(merged[0].id, "memory", "mergeSuggestions ids memory entries");
  assert(merged.length >= 4 && merged.length <= 6, "mergeSuggestions never exceeds limit");
  assertEq(merged.filter((t) => t.goal === "搜索并打开第一条结果").length, 1, "mergeSuggestions dedupes overlapping goals");
  const limited = taskMemoryMod.mergeSuggestions(
    [{ goal: "g1", count: 1 }, { goal: "g2", count: 1 }, { goal: "g3", count: 1 }],
    heur,
    2
  );
  assertEq(limited.length, 2, "mergeSuggestions honors a smaller limit");
  // recordGoal / getMemory use chrome.storage.local (mocked below).
  const memStore = {};
  global.chrome = { storage: { local: {
    get: async (key) => ({ [key]: memStore[key] }),
    set: async (obj) => { Object.assign(memStore, obj); },
    remove: async (key) => { delete memStore[key]; },
  } } };
  await taskMemoryMod.recordGoal("a.com", "搜索并打开第一条结果");
  await taskMemoryMod.recordGoal("a.com", "搜索并打开第一条结果");
  await taskMemoryMod.recordGoal("a.com", "比价");
  const fromStorage = await taskMemoryMod.getMemory();
  assert(fromStorage["a.com"] && fromStorage["a.com"][0].goal === "搜索并打开第一条结果", "recordGoal persists via chrome.storage.local");
  assertEq(fromStorage["a.com"][0].count, 2, "recordGoal increments count across calls");
  assert(!JSON.stringify(memStore).includes("sync"), "task memory never touches cloud keys");
  const mergedDomains = Object.keys(fromStorage);
  assertEq(JSON.stringify(mergedDomains), JSON.stringify(["a.com"]), "getMemory only returns recorded domains");
  delete global.chrome;

  // ── scheduled tasks (common/scheduler.js) ──
  assertEq(schedulerMod.parseTime("09:30"), 570, "parseTime converts HH:MM to minutes");
  assertEq(schedulerMod.parseTime("00:00"), 0, "parseTime handles midnight");
  assertEq(schedulerMod.parseTime("bad"), null, "parseTime rejects invalid time");
  assertEq(schedulerMod.parseTime("24:00"), null, "parseTime rejects out-of-range hour");
  assertEq(schedulerMod.formatTime(570), "09:30", "formatTime round-trips");
  assert(schedulerMod.normalizeSchedule({}).frequency === "daily", "normalizeSchedule defaults frequency daily");
  assert(schedulerMod.normalizeSchedule({ intervalMinutes: 0 }).intervalMinutes >= schedulerMod.MIN_INTERVAL_MIN, "normalizeSchedule clamps interval to MIN_INTERVAL_MIN");
  assertEq(schedulerMod.normalizeSchedule({ intervalMinutes: "15" }).intervalMinutes, 15, "normalizeSchedule coerces intervalMinutes");
  assert(schedulerMod.normalizeSchedule({}).enabled === false, "normalizeSchedule defaults disabled");
  const schedDaily = schedulerMod.normalizeSchedule({ goal: "签到", frequency: "daily", time: "09:00", enabled: true });
  const now = Date.parse("2026-08-15T08:00:00+08:00");
  const nextDaily = schedulerMod.computeNextRunAt(schedDaily, now);
  assert(nextDaily > now, "daily next run is in the future");
  assert(nextDaily - now < 2 * 86400000, "daily next run within one day");
  const atTime = schedulerMod.computeNextRunAt(schedDaily, Date.parse("2026-08-15T10:00:00+08:00"));
  assert(atTime > Date.parse("2026-08-15T10:00:00+08:00") && atTime < Date.parse("2026-08-16T10:00:00+08:00"), "daily next run rolls to tomorrow after time passed");
  const schedWeekly = schedulerMod.normalizeSchedule({ goal: "日报", frequency: "weekly", weekday: 1, time: "09:00", enabled: true });
  const nextWeekly = schedulerMod.computeNextRunAt(schedWeekly, Date.parse("2026-08-14T08:00:00+08:00"));
  assert(nextWeekly > Date.parse("2026-08-14T08:00:00+08:00"), "weekly next run is in the future");
  const wd = new Date(nextWeekly).getDay();
  assertEq(wd, 1, "weekly next run lands on Monday");
  const schedInterval = schedulerMod.normalizeSchedule({ goal: "监控", frequency: "interval", intervalMinutes: 30, enabled: true });
  assertEq(schedulerMod.computeNextRunAt(schedInterval, 1000000) - 1000000, 30 * 60000, "interval next run = now + interval");
  // Disabled / empty goals have no next run.
  assertEq(schedulerMod.computeNextRunAt({ ...schedDaily, enabled: false }, now), 0, "disabled schedule has no next run");
  assertEq(schedulerMod.computeNextRunAt({ ...schedDaily, goal: "" }, now), 0, "empty goal schedule has no next run");
  assertEq(schedulerMod.computeNextRunAt({ ...schedDaily, time: "oops" }, now), 0, "bad time schedule has no next run");
  // scheduleToAlarmInfo maps to chrome.alarms specs.
  const alarmInfo = schedulerMod.scheduleToAlarmInfo(schedDaily, now);
  assert(alarmInfo.when > now, "daily alarm spec has future when");
  assertEq(alarmInfo.periodInMinutes, 1440, "daily alarm spec repeats daily");
  const nearNow = now + 5000; // next fire within MIN_ALARM_DELAY_MS
  const nudge = schedulerMod.scheduleToAlarmInfo({ ...schedDaily, time: "00:00" }, now);
  if (nudge) assert(nudge.when - now >= schedulerMod.MIN_ALARM_DELAY_MS, "alarm spec nudges fireAt at least MIN_ALARM_DELAY_MS ahead");
  const intervalInfo = schedulerMod.scheduleToAlarmInfo(schedInterval, now);
  assertEq(intervalInfo.periodInMinutes, 30, "interval alarm spec uses periodInMinutes");
  assert(intervalInfo.when === undefined, "interval alarm spec has no when");
  assert(schedulerMod.describeSchedule(schedDaily, now).includes("每日"), "describeSchedule includes daily label");
  assert(schedulerMod.describeSchedule({ ...schedDaily, enabled: false }, now).includes("停用"), "describeSchedule notes disabled");
  assert(schedulerMod.alarmName("abc") === schedulerMod.ALARM_PREFIX + "abc", "alarmName prefixes with ALARM_PREFIX");

  // storage-backed CRUD against a mocked chrome.storage.local
  const schedStore = {};
  global.chrome = { storage: { local: {
    get: async (key) => ({ [key]: schedStore[key] }),
    set: async (obj) => { Object.assign(schedStore, obj); },
    remove: async (key) => { delete schedStore[key]; },
  } } };
  const saved = await schedulerMod.saveSchedule({ goal: "每日签到", frequency: "daily", time: "08:30", enabled: true });
  assert(saved.id, "saveSchedule assigns an id");
  const saved2 = await schedulerMod.saveSchedule({ goal: "每周日报", frequency: "weekly", weekday: 5, time: "18:00", enabled: true });
  const list = await schedulerMod.getSchedules();
  assertEq(list.length, 2, "getSchedules returns saved schedules");
  assertEq(list[0].goal, "每日签到", "getSchedules normalizes saved entries");
  const toggled = await schedulerMod.toggleSchedule(saved.id, false);
  assert(toggled.enabled === false, "toggleSchedule disables a schedule");
  const schedRes = await schedulerMod.setScheduleResult(saved.id, { status: "done", summary: "ok" });
  assertEq(schedRes.lastStatus, "done", "setScheduleResult records status");
  assert(schedRes.lastRunAt > 0, "setScheduleResult records lastRunAt");
  const afterDel = await schedulerMod.deleteSchedule(saved2.id);
  assertEq(afterDel.length, 1, "deleteSchedule removes a schedule");
  assertEq((await schedulerMod.getSchedules())[0].id, saved.id, "remaining schedule intact");
  delete global.chrome;

  // ── planner stage splitting (P0: 长任务阶段拆分) ──
  const stagedGoal = [
    "阶段1 打开编辑器：打开 https://editor.csdn.net/md/ 等加载",
    "阶段2 填标题与正文：在标题框输入标题，粘贴正文",
    "阶段3 提交发布：点击发布按钮",
  ].join("\n");
  const staged = plannerMod.splitStages(stagedGoal);
  assertEq(staged.length, 3, "splitStages splits 阶段1/2/3 into 3 steps");
  assert(staged[0].description.includes("打开编辑器"), "splitStages keeps stage1 text");
  assert(staged[2].description.includes("提交发布"), "splitStages keeps stage3 text");
  assertEq(plannerMod.splitStages("在搜索框输入 hello 并点击提交").length, 0, "splitStages ignores plain goals");
  assertEq(plannerMod.splitStages("做一件事\n第二行文字").length, 0, "splitStages ignores text without stage markers");
  // Fallback: LLM collapsing a staged goal to one step must trigger the split.
  const collapseLlm = mockLlm([() => ({ content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "发布文章" }] })] })]);
  const splitPlan = await plannerMod.plan(stagedGoal, collapseLlm);
  assert(splitPlan.steps.length >= 3, "plan falls back to stage splitting when LLM collapses to one step");
  // Normal single-goal tasks still work (no false split).
  const plainLlm = mockLlm([() => ({ content: "", toolCalls: [makeToolCall("submit_plan", { steps: [{ description: "搜索并提交" }] })] })]);
  const plainPlan = await plannerMod.plan("在搜索框输入 hello", plainLlm);
  assertEq(plainPlan.steps.length, 1, "plain goal keeps LLM's single step");

  // ── title field key (P0: 标题框识别) ──
  const fields = require("../common/fields.js");
  const titleMatch = fields.matchField("title", { role: "textbox", name: "", placeholder: "请输入文章标题" });
  assert(titleMatch.quality === "synonym", "matchField title hits 标题 placeholder");
  const titleExact = fields.matchField("title", { role: "textbox", name: "标题" });
  assert(titleExact.quality === "exact" || titleExact.quality === "synonym", "matchField title matches name=标题");
  const titleMiss = fields.matchField("title", { role: "textbox", name: "用户名" });
  assertEq(titleMiss.quality, "none", "matchField title does not hit username");

  if (failures > 0) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== ALL PASS ===");
})();


