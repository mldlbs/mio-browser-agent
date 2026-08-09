# Shadow DOM 穿透完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完善 open shadow root 穿透——修复嵌套 shadow 定位、shadowPath 改 cssPath、让 form_fill/extractPageText/waitForCondition 覆盖 shadow 元素。

**Architecture:** 新增 `content/shadow.js` 统一 shadow 遍历工具（collectOpenShadowRoots / walkShadowTree / findElementInShadows）；snapshot.js 的 `shadowPath` 每层改用 `buildCssPath(host)`；locator.js 的 `resolveShadowPath` 用 `findByCssPath` 下钻（修复 ShadowRoot 无 evaluate 导致的嵌套失败）；executor.js 的 form_fill/extract/wait 复用 shadow 工具。

**Tech Stack:** 原生 JS（浏览器 content script），无第三方依赖。测试：Node 单测 `tests/test_agent.js` + CDP 真机 `tests/cdp/run-page-tests.js`。

**测试命令：**
- 单测：`node tests/test_agent.js`（期望 `=== ALL PASS ===`）
- CDP 回归：`node tests/cdp/run-all.js`（期望 `=== ALL BROWSER SUITES PASS ===`）

---

### Task 1: 新建 content/shadow.js + 单测

**Files:**
- Create: `content/shadow.js`
- Test: `tests/test_agent.js`（顶部 require + 在 Shadow DOM 区块加断言）

- [ ] **Step 1: 写失败测试**

在 `tests/test_agent.js` 顶部 require 区（第 4 行 locatorMod 后）加：

```js
const shadowMod = require("../content/shadow.js");
```

在 Shadow DOM 区块（现有 `assert(locatorMod.findByXPath("//x", {}) === null, ...)` 第 279 行之后）加：

```js
  // ── shadow.js 统一遍历工具 ──
  const deepRoot = { mode: "open", querySelectorAll: () => [], querySelector: () => null };
  const innerHost = { nodeType: 1, shadowRoot: deepRoot, querySelectorAll: () => [deepRoot.querySelectorAll ? null : null] };
  const outerHost = { nodeType: 1, shadowRoot: { mode: "open", querySelectorAll: () => [innerHost], querySelector: () => null } };
  const mockDoc = { querySelectorAll: (sel) => (sel === "*" ? [outerHost] : []), querySelector: () => null };
  const collected = shadowMod.collectOpenShadowRoots(mockDoc);
  assert(collected.includes(deepRoot), "collectOpenShadowRoots descends nested open shadow roots", JSON.stringify(collected.map((r) => r.mode)));
  const visitedRoots = [];
  shadowMod.walkShadowTree(mockDoc, (r) => visitedRoots.push(r));
  assert(visitedRoots.length === 2, "walkShadowTree visits doc + all open roots", String(visitedRoots.length));
  const foundEl = { tagName: "INPUT" };
  const srootWithInput = { mode: "open", querySelectorAll: () => [], querySelector: (sel) => (sel === "input" ? foundEl : null) };
  const mockDoc2 = { querySelectorAll: (sel) => (sel === "*" ? [{ nodeType: 1, shadowRoot: srootWithInput }] : []), querySelector: (sel) => (sel === "input" ? null : null) };
  assert(shadowMod.findElementInShadows("input", mockDoc2) === foundEl, "findElementInShadows finds element inside open shadow root");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`Cannot find module '../content/shadow.js'`

- [ ] **Step 3: 实现 content/shadow.js**

创建 `content/shadow.js`：

```js
// Unified open-shadow-root traversal shared by snapshot, locator, and executor.
// open roots are accessible from content scripts; closed roots are not and are
// intentionally skipped everywhere.
function collectOpenShadowRoots(doc) {
  const roots = [];
  const seen = new Set();
  const visit = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return;
    let hosts;
    try {
      hosts = Array.from(container.querySelectorAll("*")).filter((el) => el.shadowRoot && el.shadowRoot.mode === "open");
    } catch (_) { return; }
    for (const host of hosts) {
      const sroot = host.shadowRoot;
      if (!sroot || seen.has(sroot)) continue;
      seen.add(sroot);
      roots.push(sroot);
      visit(sroot);
    }
  };
  visit(doc);
  return roots;
}

function walkShadowTree(doc, visitFn) {
  if (visitFn) visitFn(doc);
  for (const root of collectOpenShadowRoots(doc)) visitFn(root);
}

// Find an element matching `selector` across the document and every open
// shadow root (first hit wins, document checked first).
function findElementInShadows(selector, doc) {
  doc = doc || document;
  if (!doc || typeof doc.querySelector !== "function" || !selector) return null;
  try {
    const el = doc.querySelector(selector);
    if (el) return el;
  } catch (_) { /* bad selector: fall through */ }
  for (const root of collectOpenShadowRoots(doc)) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch (_) { /* keep scanning */ }
  }
  return null;
}

if (typeof module !== "undefined") {
  module.exports = { collectOpenShadowRoots, walkShadowTree, findElementInShadows };
} else {
  globalThis.shadowTools = { collectOpenShadowRoots, walkShadowTree, findElementInShadows };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含新 4 条 shadow.js 断言

- [ ] **Step 5: 提交**

```bash
git add content/shadow.js tests/test_agent.js
git commit -m "feat(shadow): 统一 open shadow root 遍历工具"
```

---

### Task 2: snapshot.js shadowPath 改 cssPath

**Files:**
- Modify: `content/snapshot.js:226-236`（shadow 递归段）
- Test: `tests/test_agent.js`（Shadow DOM 区块）

- [ ] **Step 1: 写失败测试**

在 Task 1 加的 shadow.js 断言之后插入：

```js
  // ── shadowPath 现在用 cssPath（宿主链），不再是 XPath ──
  const cssHost0 = { nodeType: 1, tagName: "DIV", id: "hostA", parentNode: null };
  const cssHost1 = { nodeType: 1, tagName: "DIV", id: "hostB", parentNode: null };
  assertEq(snapshotMod.buildCssPath(cssHost0), "#hostA", "shadow host cssPath uses id");
  assertEq(snapshotMod.buildCssPath(cssHost1), "#hostB", "nested shadow host cssPath uses id");
```

（该测试验证 buildCssPath 已有行为，确保 cssPath 语义是计划依赖的锚点。真正验证 shadowPath 字段值需要在 mock DOM 上跑 scanRoot，见 Step 3 说明。）

- [ ] **Step 2: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`（本步测试通过，为后续改动立基线）

- [ ] **Step 3: 实现 snapshot.js 改动**

修改 `content/snapshot.js` 顶部 require 区，引入 shadow 工具：

```js
// 在文件顶部（module require 区）加：
const shadowTools = require("./shadow.js");
// 或浏览器环境：<script src="../content/shadow.js"> 已在前，用 globalThis.shadowTools
```

在 `scanRoot` 的 shadow 递归段（:226-236）改为：

```js
  // Recurse into open shadow roots (closed roots are inaccessible by design).
  // shadowPath is a chain of host cssPaths: querySelector works on both
  // documents and ShadowRoots, so nested shadows (root inside root) resolve.
  let hosts;
  try {
    hosts = Array.from(root.querySelectorAll("*")).filter((el) => el.shadowRoot && el.shadowRoot.mode === "open");
  } catch (_) { return; }
  hosts.forEach((host) => {
    const sroot = host.shadowRoot;
    if (!sroot || visited.has(sroot)) return;
    visited.add(sroot);
    scanRoot(sroot, framePath || [], (shadowPath || []).concat(buildCssPath(host)), elements, visited);
  });
```

（改动仅一处：`buildXPath(host)` → `buildCssPath(host)`。snapshot 已递归 open shadow root，递归逻辑不变；shadowPath 值从 XPath 链变 cssPath 链。）

同时把 `content/snapshot.js` 顶部 require 改为复用 shadow 工具——把上面的 `hosts` 收集逻辑替换为：

```js
  let hosts;
  try {
    hosts = Array.from(root.querySelectorAll("*")).filter((el) => el.shadowRoot && el.shadowRoot.mode === "open");
  } catch (_) { return; }
```

`collectOpenShadowRoots` 是跨整个 document 的收集器；scanRoot 需要的是「某个容器内」的宿主收集（递归各层），两者语义不同，因此 scanRoot 内部保留原有 querySelectorAll 过滤逻辑，仅改 shadowPath 生成方式。**不需要**在 scanRoot 内替换为 collectOpenShadowRoots（它收集的是整棵树，scanRoot 已经逐层递归）。shadow.js 的 collectOpenShadowRoots 主要供 locator/executor 使用。

- [ ] **Step 4: 跑单测确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`

- [ ] **Step 5: 提交**

```bash
git add content/snapshot.js tests/test_agent.js
git commit -m "fix(shadow): shadowPath 改用宿主 cssPath 链"
```

---

### Task 3: locator.js 修复嵌套 shadow 定位

**Files:**
- Modify: `content/locator.js:15-29`（resolveShadowPath/resolveTargetRoot）
- Modify: `content/locator.js:49-81`（findByName/findByRect 遍历 shadow）
- Test: `tests/test_agent.js`

- [ ] **Step 1: 写失败测试**

在 Shadow DOM 区块加（现有 `resolveShadowPath` 断言用 XPath evaluate mock；新断言用 cssPath mock 验证嵌套）：

```js
  // ── resolveShadowPath 用 cssPath 下钻，ShadowRoot 上无 evaluate 也能穿透嵌套 ──
  const innerBtn = { tagName: "BUTTON" };
  const innerRoot = { mode: "open", querySelector: (sel) => (sel === "#inner" ? innerBtn : null) };
  const innerHost2 = { shadowRoot: innerRoot };
  const outerRoot = { mode: "open", querySelector: (sel) => (sel === "#outer" ? innerHost2 : null) };
  const docForNested = { querySelector: (sel) => (sel === "#outer" ? innerHost2 : null) };
  const nestedResolved = locatorMod.resolveShadowPath(docForNested, ["#outer", "#inner"]);
  assert(nestedResolved === innerRoot, "resolveShadowPath descends two shadow levels via cssPath", String(!!nestedResolved));

  // findByName 也能命中 shadow 内元素（role+name fallback 路径）
  const shadowBtnByName = { tagName: "BUTTON", getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
  const srootByName = { mode: "open", querySelectorAll: (sel) => (sel === "a[href],button,input,[role],[tabindex],canvas,img" || sel === INTERACTIVE_SELECTOR ? [shadowBtnByName] : []), querySelector: () => null };
  // 注：INTERACTIVE_SELECTOR 从 snapshot.js 导入，测试里用字符串常量，见下方实现说明
```

> 实现说明：`findByName`/`findByRect` 需要遍历 shadow。为让单测简单可控，改用「每容器内执行原逻辑」的结构，INTERACTIVE_SELECTOR 是 locator.js 内部常量。单测里以 `findByName` 接收的 doc mock 提供 `querySelectorAll` 返回 shadow 宿主，验证新逻辑会进 shadow。测试断言在 Step 3 实现后统一写。

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: `nestedResolved === innerRoot` FAIL（现在 resolveShadowPath 用 findByXPath，mock 容器无 evaluate 返回 null）

- [ ] **Step 3: 实现 locator.js**

修改 `content/locator.js` 顶部，引入 shadow 工具并重写 resolveShadowPath：

```js
const shadowTools = require("./shadow.js");

// Descend through open shadow roots. shadowPath is an array of host cssPaths
// (collected by snapshot.js); querySelector works on both documents and
// ShadowRoots, so nested shadows (root inside root) resolve correctly —
// unlike XPath evaluate(), which ShadowRoot does not expose.
function resolveShadowPath(root, shadowPath) {
  let container = root;
  for (const hostCss of shadowPath || []) {
    if (!container || typeof container.querySelector !== "function") return null;
    const host = findByCssPath(hostCss, container);
    if (!host || !host.shadowRoot || host.shadowRoot.mode !== "open") return null;
    container = host.shadowRoot;
  }
  return container;
}
```

修改 `findByName` 与 `findByRect`，从「只查 doc」扩展为「doc + 每个 open shadow root」：

```js
function findByName(role, name, doc) {
  doc = doc || document;
  const scan = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter((el) => !hasInteractiveDescendant(el) && isVisible(el) && computeRole(el) === role);
  };
  const matches = scan(doc);
  for (const root of shadowTools.collectOpenShadowRoots(doc)) {
    for (const el of scan(root)) {
      if (!matches.some((m) => m === el)) matches.push(el);
    }
  }
  const exact = matches.find((el) => computeAccessibleName(el) === name);
  if (exact) return exact;
  const prefix = matches.find((el) => {
    const n = computeAccessibleName(el);
    return n && (n.startsWith(name) || name.startsWith(n));
  });
  if (prefix) return prefix;
  if (name.length < 2) return null;
  return matches.find((el) => {
    const n = computeAccessibleName(el);
    return n && (n.includes(name) || name.includes(n));
  }) || null;
}

function findByRect(target, doc) {
  doc = doc || document;
  const cx = target.boundingBox.x + target.boundingBox.w / 2;
  const cy = target.boundingBox.y + target.boundingBox.h / 2;
  const scan = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter((el) => !hasInteractiveDescendant(el) && isVisible(el));
  };
  const all = scan(doc);
  for (const root of shadowTools.collectOpenShadowRoots(doc)) {
    for (const el of scan(root)) {
      if (!all.some((m) => m === el)) all.push(el);
    }
  }
  let best = null;
  let bestDist = Infinity;
  all.forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy);
    if (d < bestDist) { bestDist = d; best = el; }
  });
  return bestDist < 150 ? best : null;
}
```

更新导出（:107）加 shadowTools 所需：

```js
  module.exports = { locateElement, findByXPath, findByCssPath, findByName, findByRect, resolveFrameDoc, resolveShadowPath, resolveTargetRoot, findByCssPath };
```

（findByCssPath 已在导出中，无需新增。）

- [ ] **Step 4: 写通过测试**

在 Task 1 断言之后补完 findByName shadow 测试：

```js
  const btnEl = { nodeType: 1, tagName: "BUTTON", getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
  const hostOfBtn = { nodeType: 1, shadowRoot: { mode: "open", querySelectorAll: () => [btnEl], querySelector: () => null } };
  const docForName = { querySelectorAll: (sel) => (sel === "*" ? [hostOfBtn] : []), querySelector: () => null };
  global.INTERACTIVE_SELECTOR = "a[href],button,input,[role],[tabindex],canvas,img";
```

> 注：`findByName` 内部引用 `INTERACTIVE_SELECTOR`/`hasInteractiveDescendant`/`isVisible`/`computeRole`/`computeAccessibleName`，这些是 snapshot.js 的全局导出（测试里通过 `global` 设置或模块加载暴露）。若单测 mock 报未定义，需在测试顶部 global 补齐（现有 Shadow DOM 区块已设置 global.CSS/global.XPathResult）。实际验证以 CDP 真机断言为准（见 Task 5）。

- [ ] **Step 5: 跑测试**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含 nestedResolved 断言

- [ ] **Step 6: 提交**

```bash
git add content/locator.js tests/test_agent.js
git commit -m "fix(locator): shadowPath cssPath 下钻修复嵌套 shadow + findByName/findByRect 遍历 shadow"
```

---

### Task 4: executor.js 动作层覆盖 shadow

**Files:**
- Modify: `content/executor.js:190-199`（collectFormControls）
- Modify: `content/executor.js:424-453`（extractPageText）
- Modify: `content/executor.js:516-559`（waitForCondition）
- Test: `tests/test_agent.js`

- [ ] **Step 1: 写失败测试**

在 form_fill 单测区块加 shadow 表单 mock 测试（找到现有 formFill mock DOM 测试位置，`setupFormFillDom` 之后）：

```js
  // ── form_fill 穿透 open shadow 表单 ──
  const ffShadowInput = { tagName: "INPUT", value: "", checked: false, type: "text", offsetParent: {}, getClientRects: () => [1], form: null, dispatchEvent: () => {}, focus: () => {} };
  const ffShadowBtn = { tagName: "BUTTON", getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
  const ffShadowRoot = { mode: "open", querySelectorAll: () => [ffShadowInput], querySelector: () => null };
  const ffShadowHost = { nodeType: 1, shadowRoot: ffShadowRoot };
  // collectFormControls 现在应收集 shadow 内控件
  const ffShadowDoc = { querySelectorAll: (sel) => (sel === "*" ? [ffShadowHost] : []), querySelector: () => null };
  global.document = ffShadowDoc;
  const shadowControls = contentExecMod.collectFormControls();
  assert(shadowControls.some((c) => c.el === ffShadowInput), "collectFormControls collects inputs inside open shadow root", String(shadowControls.length));
```

> 注：`collectFormControls` 内部引用 `computeRole`/`computeAccessibleName`（snapshot.js 全局）。测试需确保 global 补齐。单测验证「控件被收集」；「匹配 + 填充 + 提交」由 CDP 真机（Task 5）覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`shadowControls.length === 0`

- [ ] **Step 3: 实现 executor.js**

在 `content/executor.js` 顶部 require 区加 shadow 工具：

```js
const shadowTools = require("./shadow.js");
```

修改 `collectFormControls`（:190-199）：

```js
function collectFormControls() {
  const scan = (container) => {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox'], [role='checkbox'], [role='radio']"
    ));
  };
  const all = scan(document);
  for (const root of shadowTools.collectOpenShadowRoots(document)) {
    for (const el of scan(root)) {
      if (!all.some((m) => m === el)) all.push(el);
    }
  }
  const visible = all.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
  return visible.map((el) => {
    const role = (typeof computeRole === "function") ? computeRole(el) : (el.tagName === "SELECT" ? "combobox" : "textbox");
    return { el, role, name: computeAccessibleName(el), placeholder: el.getAttribute("placeholder") || "", value: controlValue(el) };
  });
}
```

修改 `extractPageText`（:424-453），在 iframe 文本追加之后加 shadow 文本：

```js
  // Append readable text from same-origin iframes (common for rich editors).
  const frames = [];
  try {
    Array.from(document.querySelectorAll("iframe")).forEach((iframe) => {
      if (!iframe.contentDocument || !iframe.contentDocument.body) return;
      const t = (iframe.contentDocument.body.innerText || "").trim();
      if (t) frames.push(t);
    });
  } catch (_) { /* cross-origin iframes are skipped */ }
  if (frames.length && text.length < maxChars) {
    text = (text + "\n\n[iframe]\n" + frames.join("\n\n")).trim();
  }
  // Append text from open shadow roots (component libraries hide UI text there).
  for (const root of shadowTools.collectOpenShadowRoots(document)) {
    if (!root || !root.innerText) continue;
    const t = (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    if (t && text.length < maxChars) {
      text = (text + "\n\n[shadow]\n" + t).trim();
    }
  }
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n…(truncated)";
  return { ok: true, value: { url: location.href, title: document.title, text } };
```

修改 `waitForCondition`（:516-559），selector/text 匹配扩展到 shadow：

```js
function waitForCondition(args) {
  const timeout = Math.max(0, args.timeout || 8000);
  const start = Date.now();
  const matches = (doc) => {
    if (args.selector) {
      const found = shadowTools.findElementInShadows(args.selector, doc) != null;
      if (args.disappear && !found) return true;
      if (!args.disappear && found) return true;
    }
    if (args.text) {
      const hasText = (doc) => {
        if (doc.body && doc.body.innerText && doc.body.innerText.includes(args.text)) return true;
        for (const root of shadowTools.collectOpenShadowRoots(doc)) {
          if (root.innerText && root.innerText.includes(args.text)) return true;
        }
        return false;
      };
      const has = hasText(doc);
      if (args.disappear && !has) return true;
      if (!args.disappear && has) return true;
    }
    if (args.urlContains) {
      const has = location.href.includes(args.urlContains);
      if (args.disappear && !has) return true;
      if (!args.disappear && has) return true;
    }
    return false;
  };
  const check = () => {
    if (matches(document)) return true;
    let any = false;
    try {
      Array.from(document.querySelectorAll("iframe")).forEach((f) => {
        if (f.contentDocument && matches(f.contentDocument)) any = true;
      });
    } catch (_) { /* cross-origin skipped */ }
    return any;
  };
  return (async () => {
    let saw = check();
    while (!saw && Date.now() - start < timeout) {
      await sleepMs(300);
      saw = check();
    }
    const waited = Date.now() - start;
    return saw
      ? { ok: true, value: `condition satisfied after ${waited}ms` }
      : { ok: false, error: `timeout after ${waited}ms waiting for condition`, errorCode: "WAIT_TIMEOUT" };
  })();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含 shadow 表单控件收集断言

- [ ] **Step 5: 提交**

```bash
git add content/executor.js tests/test_agent.js
git commit -m "feat(executor): form_fill/extract/wait 覆盖 open shadow root"
```

---

### Task 5: test-page.html 夹具 + CDP 断言

**Files:**
- Modify: `tests/test-page.html`
- Modify: `tests/cdp/run-page-tests.js`
- Modify: `tests/browser-test.js`（简单版 shadow 断言，如需保持一致）

- [ ] **Step 1: test-page.html 加夹具**

在 `#shadow-host` 的 script 里追加嵌套 shadow + shadow 表单：

```html
  <div id="nested-shadow-host"></div>
  <div id="shadow-form-host"></div>
```

在现有 `<script>`（第 53-63 行）的 `(function () { ... })();` 内追加：

```js
      // nested shadow: outer open root → inner open root → input (3 levels)
      const nestHost = document.getElementById("nested-shadow-host");
      const nestRoot = nestHost.attachShadow({ mode: "open" });
      const innerHost = document.createElement("div");
      innerHost.id = "shadow-inner-host";
      nestRoot.appendChild(innerHost);
      const innerRoot = innerHost.attachShadow({ mode: "open" });
      innerRoot.innerHTML =
        '<input id="nested-input" type="text" placeholder="嵌套shadow输入框">' +
        '<button id="nested-btn" onclick="window.__nestedClicks=(window.__nestedClicks||0)+1">嵌套幽灵按钮</button>';
      // shadow form: form + username/password + checkbox + submit inside one root
      const formHost = document.getElementById("shadow-form-host");
      const formRoot = formHost.attachShadow({ mode: "open" });
      formRoot.innerHTML =
        '<form id="shadow-form" onsubmit="window.__shadowFormSubmitted=(window.__shadowFormSubmitted||0)+1; return false;">' +
        '<label for="sf2-username">用户名</label>' +
        '<input id="sf2-username" type="text" name="username" placeholder="shadow用户名">' +
        '<label for="sf2-password">密码</label>' +
        '<input id="sf2-password" type="password" name="password" placeholder="shadow密码">' +
        '<label><input id="sf2-agree" type="checkbox" name="agree"> 同意</label>' +
        '<button id="sf2-submit" type="submit">shadow登录</button></form>';
```

- [ ] **Step 2: 加 CDP 断言**

在 `tests/cdp/run-page-tests.js` 现有 Shadow DOM 断言块（第 86 行 `executor clicks button inside shadow root` 之后）追加：

```js
      // 嵌套 shadow：3 层穿透（document → root → root）快照/定位/点击/输入
      const nsBtn = snap.elements.find((e) => e.name && e.name.includes("嵌套幽灵按钮"));
      check(!!nsBtn && nsBtn.shadowPath.length === 2, "snapshot captures nested shadow button (shadowPath depth 2)", nsBtn && JSON.stringify(nsBtn.shadowPath));
      const nsInput = snap.elements.find((e) => e.placeholder === "嵌套shadow输入框");
      check(!!nsInput && nsInput.shadowPath.length === 2, "snapshot captures nested shadow input", nsInput && JSON.stringify(nsInput.shadowPath));
      const nsLoc = locateElement(nsBtn);
      check(!!nsLoc && nsLoc.id === "nested-btn", "locator resolves nested shadow element via cssPath shadowPath", nsLoc && nsLoc.id);
      window.__nestedClicks = 0;
      const nsClick = await executeAction({ name: "click", target: nsBtn, args: {} });
      check(nsClick.ok && window.__nestedClicks === 1, "executor clicks button 2 levels deep in shadow", nsClick.ok);
      const nsType = await executeAction({ name: "type", target: nsInput, args: { text: "deep", clear: true } });
      const nsInputEl = document.getElementById("nested-shadow-host").shadowRoot.firstChild.shadowRoot.getElementById("nested-input");
      check(nsType.ok && nsInputEl.value === "deep", "executor types into nested shadow input", nsInputEl.value);

      // shadow 表单：form_fill 一次填完并提交
      window.__shadowFormSubmitted = 0;
      const ffShadowRes = await executeAction({ name: "form_fill", target: null, args: { fields: { username: "shadowu", password: "shadowp", agree: true }, submit: true } });
      const shadowForm = document.getElementById("shadow-form-host").shadowRoot.getElementById("shadow-form");
      const sfUser = shadowForm.querySelector("#sf2-username");
      const sfPass = shadowForm.querySelector("#sf2-password");
      const sfAgree = shadowForm.querySelector("#sf2-agree");
      check(ffShadowRes.ok && sfUser.value === "shadowu" && sfPass.value === "shadowp", "form_fill fills shadow form fields", JSON.stringify(ffShadowRes));
      check(sfAgree.checked === true, "form_fill checks checkbox inside shadow root", String(sfAgree.checked));
      check(window.__shadowFormSubmitted === 1, "form_fill submits the shadow form", String(window.__shadowFormSubmitted));

      // waitForCondition text inside shadow root is detected
      const wfShadow = await executeAction({ name: "wait", target: null, args: { text: "shadow登录", timeout: 500 } });
      check(wfShadow.ok, "waitForCondition finds text inside open shadow root", (wfShadow && wfShadow.error) || "");
```

- [ ] **Step 3: 跑 CDP 测试确认通过**

Run: `node tests/cdp/run-page-tests.js`
Expected: 全部 check PASS，含新增 8 条 shadow 断言

- [ ] **Step 4: 跑全量回归**

Run: `node tests/cdp/run-all.js`
Expected: `=== ALL BROWSER SUITES PASS ===`

- [ ] **Step 5: 提交**

```bash
git add tests/test-page.html tests/cdp/run-page-tests.js
git commit -m "test(shadow): 嵌套 shadow + shadow 表单 CDP 全链路夹具"
```

---

### Task 6: 版本 bump + 回归文档

**Files:**
- Modify: `manifest.json`（0.1.40 → 0.1.41）
- Modify: `docs/test-prompts.md`（场景八任务 4 + 速查表）

- [ ] **Step 1: bump 版本**

```bash
cd E:\work\code\browser-agent
# 用 Python 改 manifest.json version 0.1.40 -> 0.1.41（保持 ensure_ascii=False, indent=2）
```

- [ ] **Step 2: 更新回归文档**

`docs/test-prompts.md` 场景八（form_fill）新增「任务 4 · shadow 表单」：

```
### 任务 4 · 中阶（shadow DOM 表单）

```
打开一个用 Web Components / 组件库构建的含表单页面（如 MUI 组件的 TextField 示例页，或任意将表单放进 open shadow root 的站），用表单填充填写字段（用户名、密码）并勾选一个复选框，确认提交生效。
```

**期望行为**：`form_fill` 穿透 open shadow root 找到字段 → 填充 → 勾选 → 提交。

**验收标准**：字段在 shadow 内被识别填充；checkbox 勾选同步；提交生效。

**失败信号**：shadow 内字段 not_found、form_fill 报 FIELD_NOT_FOUND、checkbox 勾了但提交数据为 false。
```

回归速查表补一行：

```
| form_fill | 4 shadow 表单 | 穿透 open shadow root 填表+提交 | ⭐⭐⭐⭐ |
```

- [ ] **Step 3: 提交**

```bash
git add manifest.json docs/test-prompts.md
git commit -m "chore: bump version to 0.1.41 + 回归集补 shadow 表单场景"
```

- [ ] **Step 4: 全量验证**

Run: `node tests/test_agent.js` → `=== ALL PASS ===`
Run: `node tests/cdp/run-all.js` → `=== ALL BROWSER SUITES PASS ===`

---

### Task 7: 同步 agent-dev 镜像（交付）

**Files:**
- Copy: browser-agent 变更文件 → `E:\work\code\agent-dev\chrome-ext-agent\`

- [ ] **Step 1: 同步变更文件**

```powershell
Copy-Item -Force E:\work\code\browser-agent\content\shadow.js E:\work\code\agent-dev\chrome-ext-agent\content\shadow.js
Copy-Item -Force E:\work\code\browser-agent\content\snapshot.js E:\work\code\agent-dev\chrome-ext-agent\content\snapshot.js
Copy-Item -Force E:\work\code\browser-agent\content\locator.js E:\work\code\agent-dev\chrome-ext-agent\content\locator.js
Copy-Item -Force E:\work\code\browser-agent\content\executor.js E:\work\code\agent-dev\chrome-ext-agent\content\executor.js
Copy-Item -Force E:\work\code\browser-agent\tests\test_agent.js E:\work\code\agent-dev\chrome-ext-agent\tests\test_agent.js
Copy-Item -Force E:\work\code\browser-agent\tests\test-page.html E:\work\code\agent-dev\chrome-ext-agent\tests\test-page.html
Copy-Item -Force E:\work\code\browser-agent\tests\cdp\run-page-tests.js E:\work\code\agent-dev\chrome-ext-agent\tests\cdp\run-page-tests.js
Copy-Item -Force E:\work\code\browser-agent\manifest.json E:\work\code\agent-dev\chrome-ext-agent\manifest.json
Copy-Item -Force E:\work\code\browser-agent\docs\test-prompts.md E:\work\code\agent-dev\chrome-ext-agent\docs\test-prompts.md
Copy-Item -Force E:\work\code\browser-agent\docs\superpowers\specs\2026-08-09-shadow-dom-design.md E:\work\code\agent-dev\chrome-ext-agent\docs\superpowers\specs\2026-08-09-shadow-dom-design.md
```

- [ ] **Step 2: 提交 agent-dev**

```powershell
git -C E:\work\code\agent-dev\chrome-ext-agent add -A
git -C E:\work\code\agent-dev\chrome-ext-agent commit -m "feat(shadow): 完善 open shadow 穿透 + bump 0.1.41"
```

- [ ] **Step 3: push browser-agent main**

```powershell
git -C E:\work\code\browser-agent push origin main
```

- [ ] **Step 4: 汇报**

汇总：提交列表、测试结果（单测 + CDP）、版本号；询问是否发布 v0.1.41（按新规则需用户确认）。
