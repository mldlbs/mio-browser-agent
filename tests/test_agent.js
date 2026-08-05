const protocol = require("../common/protocol.js");
const snapshotMod = require("../content/snapshot.js");
const contentExecMod = require("../content/executor.js");
const locatorMod = require("../content/locator.js");
const storage = require("../common/storage.js");
const historyMod = require("../common/history.js");
const adapterMod = require("../llm/adapter.js");
global.registerProvider = adapterMod.registerProvider;
global.normalizeCompletion = adapterMod.normalizeCompletion;
require("../llm/openai.js");
const registryMod = require("../tools/registry.js");
global.registerTool = registryMod.registerTool;
require("../tools/click.js");
require("../tools/type.js");
require("../tools/scroll.js");
require("../tools/wait.js");
require("../tools/navigate.js");
require("../tools/extract_text.js");
require("../tools/paste.js");
require("../tools/tab.js");
const plannerMod = require("../sidepanel/planner.js");
const memoryMod = require("../sidepanel/memory.js");
const executorMod = require("../sidepanel/executor.js");
global.snapshotToLines = protocol.snapshotToLines;
global.snapshotStats = protocol.snapshotStats;
global.planner = plannerMod;
global.executor = executorMod;
global.createMemory = memoryMod.createMemory;
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

  // ── pasteText: writes into contenteditable and textarea ──
  let editableText = "";
  const editable = {
    isContentEditable: true,
    textContent: "",
    focus: () => {},
    dispatchEvent: () => {},
  };
  const pe = contentExecMod.pasteText(editable, "正文第一段", false);
  assert(pe.ok && editable.textContent === "正文第一段", "pasteText writes into contenteditable");
  const clearEd = contentExecMod.pasteText(editable, "覆盖", true);
  assert(clearEd.ok && editable.textContent === "覆盖", "pasteText clear replaces contenteditable");
  const area = {
    tagName: "TEXTAREA",
    value: "",
    focus: () => {},
    dispatchEvent: () => {},
  };
  const pa = contentExecMod.pasteText(area, "段落A\n段落B", false);
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
  const shadowRootMock = { mode: "open", isShadowRoot: true };
  const shadowHost = { nodeType: 1, shadowRoot: shadowRootMock };
  const evalDoc = { evaluate: () => ({ singleNodeValue: shadowHost }) };
  const resolved = locatorMod.resolveShadowPath(evalDoc, ["//*[@id='host']"]);
  assert(resolved === shadowRootMock, "resolveShadowPath descends into open shadow root");
  assert(locatorMod.resolveShadowPath(evalDoc, []) === evalDoc, "resolveShadowPath empty path stays on container");
  const shadowBtn = { tagName: "BUTTON" };
  const sroot = { querySelector: (sel) => (sel === "#shadow-btn" ? shadowBtn : null) };
  assert(locatorMod.findByCssPath("#shadow-btn", sroot) === shadowBtn, "findByCssPath works on ShadowRoot-like container");
  assert(locatorMod.findByCssPath("", sroot) === null, "findByCssPath empty returns null");
  assert(locatorMod.findByCssPath("#nope", { querySelector: () => null }) === null, "findByCssPath miss returns null");
  assert(locatorMod.findByXPath("//x", {}) === null, "findByXPath guards non-evaluate containers");

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

  // ── snapshotStats summary ──
  const stats = protocol.snapshotStats(snap);
  assert(stats.includes("2 elements"), "snapshotStats reports element count");
  assert(stats.includes("url: https://x.com"), "snapshotStats includes url");
  assertEq(protocol.snapshotStats(null), "(no snapshot)", "snapshotStats null safe");

  // ── storage ──
  const s = storage.normalizeSettings({ apiKey: "k" });
  assertEq(s.provider, "openai", "normalizeSettings provider default");
  assertEq(s.apiKey, "k", "normalizeSettings keeps apiKey");

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
  assert(res2.ok, "executor completes after replan");

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

  // ══ Phase 1: Recovery Engine unit tests ══
  const policy = require("../sidepanel/recovery-policy.js");
  const sorted = policy.getAllowedActions("ELEMENT_NOT_FOUND");
  assert(sorted[0].action === "retry_snapshot" && sorted[0].priority === 100, "policy sorts ELEMENT_NOT_FOUND by priority desc");
  assert(policy.getAllowedActions("ELEMENT_NOT_FOUND").some((a) => a.action === "finish"), "policy includes finish as fallback");
  assert(policy.getAllowedActions("ELEMENT_NOT_FOUND").length === 3, "policy exposes all configured actions");
  assert(policy.getAllowedActions("UNKNOWN_CODE").length === 0, "policy returns empty for unknown error code");
  assert(policy.getMaxAttemptsForAction("NO_TOOL_CALLS", "scroll_and_retry") === 1, "policy exposes per-action max attempts");

  const reMod = require("../sidepanel/recovery-engine.js");
  const rrResult = await reMod.runRecovery(
    { lastError: { code: "ELEMENT_NOT_FOUND" }, recoveryAttempt: 1, maxRecoveryAttempts: 2, recoveryHistory: [] }
  );
  assert(rrResult.status === "retry" && rrResult.nextTurn === "act" && rrResult.detail.action === "retry_snapshot", "engine picks top-priority action for first attempt");
  const rrExhaust = await reMod.runRecovery(
    { lastError: { code: "ELEMENT_NOT_FOUND" }, recoveryAttempt: 2, maxRecoveryAttempts: 2, recoveryHistory: ["retry_snapshot"] }
  );
  assert(rrExhaust.status === "finish", "engine finishes when attempts exceeded");
  const rrNoAllowed = await reMod.runRecovery(
    { lastError: { code: "UNKNOWN" }, recoveryAttempt: 1, maxRecoveryAttempts: 2, recoveryHistory: [] }
  );
  assert(rrNoAllowed.status === "finish", "engine finishes when no allowed actions");
  const rrDup = await reMod.runRecovery(
    { lastError: { code: "ELEMENT_NOT_FOUND" }, recoveryAttempt: 1, maxRecoveryAttempts: 2, recoveryHistory: ["wait_and_retry", "retry_snapshot"] }
  );
  assert(rrDup.status === "retry" && rrDup.detail.action === "scroll_and_retry", "engine falls back to next priority to avoid consecutive duplicate");

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
  assert(recEvents.some((e) => e.kind === "attempt" && e.action === "retry_snapshot"), "recovery emits retry_snapshot attempt event");

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
  assert(rendered.includes("[步骤 3] ❌ ELEMENT_NOT_FOUND"), "render shows step + error");
  assert(rendered.includes("✓ retry_snapshot"), "render marks successful attempt");
  assert(rendered.includes("✗ scroll_and_retry"), "render marks failed attempt");
  assert(rendered.includes("恢复用尽"), "render shows exhausted outcome");
  assertEq(revMod.renderEventStream(revMod.startEvents()), "", "empty events render empty");

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

  // ── memory: navigation / tab switch does not report a noisy diff ──
  const tabMem = memoryMod.createMemory();
  tabMem.remember({ url: "https://a.example", title: "A", elements: [{ role: "button", name: "X" }] });
  const switched = tabMem.remember({ url: "https://b.example", title: "B", elements: [{ role: "textbox", name: "Y" }] });
  assertEq(switched.added.length, 0, "tab switch suppresses added diff");
  assertEq(switched.removed.length, 0, "tab switch suppresses removed diff");
  const samePage = tabMem.remember({ url: "https://b.example", title: "B", elements: [{ role: "textbox", name: "Z" }] });
  assert(samePage.added.includes("textbox:Z"), "same-page diff still reported after switch");

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
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn1 → recover retry_snapshot
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn2 → recover scroll_and_retry
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn3 → recover retry_snapshot
    () => ({ content: "", toolCalls: [makeToolCall("click", { index: 99 })] }), // turn4 → recover vision_locate
    () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "ok" })] }), // turn5 → succeed
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
      maxTurns: 6, maxRecoveryAttempts: 2, isStopped: () => false,
      visionLlm: visionRuntimeLlm, // injected for the vision pass
    }
  );
  assert(vExec.ok && vExec.summary === "ok", "enabled vision recovery lets the step succeed");
  assert(visionEvents.some((e) => e.action === "vision_locate"), "vision_locate recovery event emitted");

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

  // A distinct later click (after a successful non-click action) is allowed.
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
  assert(dupExec2.ok, "non-consecutive clicks still complete");
  assertEq(clickCalls2.filter((n) => n === "click").length, 2, "clicks separated by an action both execute");

  if (failures > 0) { console.log("\n" + failures + " FAILURE(S)"); process.exit(1); }
  console.log("\n=== ALL PASS ===");
})();
