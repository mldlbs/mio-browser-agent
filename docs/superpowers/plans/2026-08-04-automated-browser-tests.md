# 自动化真实浏览器集成测试（CDP 零依赖）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用零第三方依赖的 Chrome DevTools Protocol 测试层，把现有"需人工开浏览器看 console"的 content 逻辑验证（browser-test.js）升级为可一条命令自动运行、可接入 CI 的真实浏览器集成测试。

**Architecture:** Node 22 原生 `WebSocket` + `fetch` 直连 Chrome `--remote-debugging-port`，封装一个最小 CDP 客户端（`tests/cdp/`）。测试分两层：(1) 真实 DOM 页面层——加载 `tests/test-page.html`，在真实浏览器里跑 snapshot/locator/executor 断言（替代人工验证）；(2) 真实扩展层——`--load-extension` 加载 unpacked 扩展，验证 content script 注入 + 页面桥通信。统一 runner 汇总 PASS/FAIL 并设置进程退出码，供 CI 调用。

**Tech Stack:** Node.js 22+（原生 WebSocket/fetch）、Chrome/Chromium headless、CDP 协议。零 npm 依赖。

---

### Task 1: CDP 客户端基础层

**Files:**
- Create: `tests/cdp/client.js`
- Test: `tests/cdp/smoke.js`

- [ ] **Step 1: 写最小 CDP 客户端**

```javascript
// tests/cdp/client.js
"use strict";
// Zero-dependency CDP client using Node 22 native WebSocket.
// Wraps a browser-level (or target-level) WebSocket with a promise-based send().

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 0;
    const pending = new Map();
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}, sessionId = null) {
          return new Promise((res, rej) => {
            const id = ++nextId;
            pending.set(id, { res, rej });
            const msg = { id, method, params };
            if (sessionId) msg.sessionId = sessionId;
            ws.send(JSON.stringify(msg));
          });
        },
        close() { ws.close(); },
      });
    });
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error("CDP socket error: " + e.message)));
  });
}

// Fetch the browser-level debugger URL from the HTTP endpoint.
async function getBrowserWsUrl(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      const json = await resp.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`CDP endpoint on port ${port} not reachable`);
}

module.exports = { connect, getBrowserWsUrl };
```

- [ ] **Step 2: 写启动器（spawn Chrome headless，管理生命周期）**

```javascript
// tests/cdp/launch.js
"use strict";
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { connect, getBrowserWsUrl } = require("./client");

// Resolve chrome.exe across common Windows install paths.
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Chrome not found. Set CHROME_PATH.");
}

// Launch a headless Chrome with remote debugging on a random free port.
// Returns { browser: cdpClient, ws, port, kill }.
async function launchChrome(options = {}) {
  const chrome = findChrome();
  const port = options.port || 9300 + Math.floor(Math.random() * 1000);
  const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "mio-cdp-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
  ];
  if (options.loadExtension) {
    // headless + extension requires --load-extension with a normal profile in newer Chrome
    args.push(`--load-extension=${path.resolve(options.loadExtension)}`);
  }
  if (options.browserArgs) args.push(...options.browserArgs);
  args.push(options.url || "about:blank");

  const proc = spawn(chrome, args, { stdio: "ignore" });
  const ws = await getBrowserWsUrl(port);
  const browser = await connect(ws);
  return {
    browser, ws, port, userDataDir,
    kill() {
      try { proc.kill(); } catch (_) {}
      try { browser.close(); } catch (_) {}
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

module.exports = { launchChrome, findChrome };
```

- [ ] **Step 3: 写冒烟测试验证客户端链路**

```javascript
// tests/cdp/smoke.js
"use strict";
const { launchChrome } = require("./launch");

(async () => {
  const launched = await launchChrome();
  try {
    // create a tab, attach, navigate, evaluate
    const { targetId } = await launched.browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await launched.browser.send("Target.attachToTarget", { targetId, flatten: true });
    await launched.browser.send("Page.enable", {}, sessionId);
    await launched.browser.send("Page.navigate", { url: "data:text/html,<h1 id=h>smoke</h1>" }, sessionId);
    await new Promise((r) => setTimeout(r, 500));
    const { result } = await launched.browser.send("Runtime.evaluate", {
      expression: "document.querySelector('#h').textContent", returnByValue: true,
    }, sessionId);
    if (result.value !== "smoke") throw new Error("evaluate mismatch: " + result.value);
    console.log("SMOKE OK: " + result.value);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("SMOKE FAIL: " + e.message); process.exit(1); });
```

- [ ] **Step 4: 运行冒烟测试验证通过**

Run: `node tests/cdp/smoke.js`
Expected: `SMOKE OK: smoke`（并能在后台看到 headless Chrome 短暂启动）

- [ ] **Step 5: 提交**

```bash
git add tests/cdp/
git commit -m "test: zero-dep CDP client + launch + smoke probe"
```

---

### Task 2: 页面内测试 runner（在真实 DOM 里跑现有 content 逻辑断言）

**Files:**
- Create: `tests/cdp/page-runner.js`
- Modify: `tests/test-page.html`（补充更多可测元素）
- Test: 运行 `tests/cdp/run-page-tests.js`

- [ ] **Step 1: 写 page-runner（注入并收集断言结果）**

目标：在真实浏览器里加载 `test-page.html`（它已引入 snapshot/locator/executor 脚本），通过 CDP 注入一段断言脚本，把 PASS/FAIL 行收集回 Node 端。

```javascript
// tests/cdp/page-runner.js
"use strict";
// Drives a Chrome tab to a URL, injects an assertion script, collects results.

async function openTab(browser, url) {
  const { targetId } = await browser.send("Target.createTarget", { url });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  // wait for load
  await new Promise((r) => setTimeout(r, 800));
  return { targetId, sessionId };
}

// Evaluate an async script body in the page; the body must call
// window.__mioResults = window.__mioResults || []; window.__mioResults.push({ok,name})
// Returns collected results.
async function runInPage(browser, sessionId, script) {
  const { result, exceptionDetails } = await browser.send("Runtime.evaluate", {
    expression: `(async () => { ${script} })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (exceptionDetails) throw new Error("page script threw: " + JSON.stringify(exceptionDetails).slice(0, 300));
  return result && result.value ? result.value : [];
}

function report(results) {
  let fails = 0;
  for (const r of results) {
    if (r.ok) console.log("PASS: " + r.name);
    else { fails++; console.log("FAIL: " + r.name + (r.detail ? " (" + r.detail + ")" : "")); }
  }
  console.log(fails === 0 ? "=== ALL PASS ===" : fails + " FAILURE(S)");
  return fails;
}

module.exports = { openTab, runInPage, report };
```

- [ ] **Step 2: 写页面级集成测试**

内容：在真实 DOM 上跑 snapshot / locateElement / type / click / contenteditable（复用现有 browser-test.js 的断言点，但通过 CDP 自动化驱动）。

```javascript
// tests/cdp/run-page-tests.js
"use strict";
const path = require("path");
const { launchChrome } = require("./launch");
const { openTab, runInPage, report } = require("./page-runner");

(async () => {
  const testPageUrl = "file:///" + path.resolve(__dirname, "../test-page.html").replace(/\\/g, "/");
  const launched = await launchChrome({ url: testPageUrl });
  try {
    const { sessionId } = await openTab(launched.browser, testPageUrl);
    const results = await runInPage(launched.browser, sessionId, `
      const out = [];
      const check = (cond, name, detail) => out.push({ ok: !!cond, name, detail });

      const snap = captureSnapshot();
      check(snap.elements.length >= 4, "snapshot captures >= 4 interactive elements", "got " + snap.elements.length);
      const btn = snap.elements.find((e) => e.role === "button" && e.name.includes("登录"));
      check(!!btn, "snapshot finds login button");
      const inp = snap.elements.find((e) => e.role === "textbox" && e.placeholder);
      check(!!inp, "snapshot finds textbox with placeholder");
      const ed = snap.elements.find((e) => e.role === "textbox" && e.tag === "div");
      check(!!ed, "snapshot finds contenteditable as textbox");

      const el = locateElement(btn);
      check(!!el && el.id === "btn-login", "locator round-trips snapshot element", el && el.id);

      const typeRes = executeAction({ name: "type", target: inp, args: { text: "hello", clear: true } });
      check(typeRes.ok && document.getElementById("input-search").value === "hello", "executor types into input");

      window.__clicked = 0;
      const clickRes = executeAction({ name: "click", target: btn, args: {} });
      check(clickRes.ok && window.__clicked === 1, "executor clicks button");

      const edRes = executeAction({ name: "type", target: ed, args: { text: "x", clear: true } });
      check(edRes.ok && document.getElementById("box-editor").textContent === "x", "executor types into contenteditable");

      const edClear = executeAction({ name: "type", target: ed, args: { text: "abc", clear: false } });
      check(edClear.ok && document.getElementById("box-editor").textContent === "xabc", "executor appends to contenteditable");

      return out;
    `);
    const fails = report(results);
    if (fails > 0) process.exit(1);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("PAGE TESTS FAIL: " + e.message); process.exit(1); });
```

- [ ] **Step 3: 运行页面级测试，补齐失败点**

Run: `node tests/cdp/run-page-tests.js`
Expected: 所有断言 PASS；`=== ALL PASS ===`。若有失败（例如 snapshot 元素数不足），在 `test-page.html` 补充元素或调整断言到真实预期。

- [ ] **Step 4: 提交**

```bash
git add tests/cdp/
git commit -m "test: automated real-DOM content logic tests via CDP"
```

---

### Task 3: 真实扩展加载测试（content script 注入 + 消息桥）

**Files:**
- Create: `tests/cdp/extension-harness.js`
- Create: `tests/cdp/run-extension-tests.js`
- Test: `tests/cdp/run-extension-tests.js`

- [ ] **Step 1: 验证 headless 下扩展可加载**

先手动验证（关键风险点）。用启动器加 `--load-extension=<repo root>`，打开测试页，检查 content script 是否注入：

```javascript
// tests/cdp/extension-harness.js
"use strict";
const { launchChrome } = require("./launch");
const { openTab, runInPage, report } = require("./page-runner");

// Note: MV3 extensions in headless=new generally work if the extension uses
// content scripts (no action popup needed). Side panel needs a real profile;
// we test content-script injection + messaging here.

async function loadExtensionHarness(extensionDir, testUrl) {
  const launched = await launchChrome({ loadExtension: extensionDir, url: testUrl });
  const { sessionId } = await openTab(launched.browser, testUrl);
  return { launched, sessionId };
}

module.exports = { loadExtensionHarness };
```

- [ ] **Step 2: 写扩展注入测试**

```javascript
// tests/cdp/run-extension-tests.js
"use strict";
const path = require("path");
const { loadExtensionHarness } = require("./extension-harness");
const { runInPage, report } = require("./page-runner");

(async () => {
  const root = path.resolve(__dirname, "..", "..");
  const testUrl = "file:///" + path.resolve(__dirname, "../test-page.html").replace(/\\/g, "/");
  const { launched, sessionId } = await loadExtensionHarness(root, testUrl);
  try {
    const results = await runInPage(launched.browser, sessionId, `
      const out = [];
      const check = (cond, name, detail) => out.push({ ok: !!cond, name, detail });
      // content scripts from the extension should have been injected by the browser
      check(typeof window.mioContentLoaded === "boolean", "content main script injected");
      return out;
    `);
    const fails = report(results);
    if (fails > 0) process.exit(1);
  } finally {
    launched.kill();
  }
})().catch((e) => { console.error("EXTENSION TESTS FAIL: " + e.message); process.exit(1); });
```

> 注意：当前 content script 用 `main.js` 入口，未定义 `window.mioContentLoaded`。此测试需要一个最小的注入标记。若 `content/main.js` 顶部已有可见副作用（如建立 listener），测试改为检测该副作用；否则在 `main.js` 加一行 `window.mioContentLoaded = true;`（该标记对生产无害）。

- [ ] **Step 3: 运行扩展测试，若 headless 注入失败则记录并跳过**

Run: `node tests/cdp/run-extension-tests.js`
Expected: 若 `--load-extension` 在 headless 下注入 content script 成功 → PASS；若因 headless 限制无法加载扩展 → 明确打印 `EXTENSION LOADING NOT SUPPORTED IN THIS CHROME` 且测试以退出码 0 跳过（记录已知限制，headful 模式 CI 用 xvfb 时启用）。

- [ ] **Step 4: 提交**

```bash
git add tests/cdp/
git commit -m "test: extension content-script injection harness via CDP"
```

---

### Task 4: 统一 runner + CI 配置

**Files:**
- Create: `tests/cdp/run-all.js`
- Create: `.github/workflows/test.yml`
- Modify: `README.md`（测试章节更新）

- [ ] **Step 1: 写统一 runner**

```javascript
// tests/cdp/run-all.js
"use strict";
// Runs all automated browser tests in sequence. Exits nonzero on any failure.
const { spawnSync } = require("child_process");
const path = require("path");

const scripts = ["smoke.js", "run-page-tests.js", "run-extension-tests.js"];
let failed = 0;
for (const s of scripts) {
  console.log("\n=== " + s + " ===");
  const r = spawnSync(process.execPath, [path.join(__dirname, s)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log(s + " FAILED (exit " + r.status + ")"); }
  else console.log(s + " PASSED");
}
if (failed > 0) { console.log("\n" + failed + " suite(s) failed"); process.exit(1); }
console.log("\n=== ALL BROWSER SUITES PASS ===");
```

- [ ] **Step 2: 写 GitHub Actions 工作流**

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: node tests/test_agent.js
  browser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      # GitHub-hosted ubuntu has Chrome preinstalled at this path
      - run: node tests/cdp/run-all.js
        env: { CHROME_PATH: "/usr/bin/google-chrome" }
```

- [ ] **Step 3: 本地完整跑一遍**

Run: `node tests/cdp/run-all.js`
Expected: 三个 suite 依次输出 PASSED；末尾 `=== ALL BROWSER SUITES PASS ===`。
同时跑单测：`node tests/test_agent.js` → `=== ALL PASS ===`。

- [ ] **Step 4: 更新 README 测试章节**

把「🧪 测试」一节从手动浏览器验证改为描述两条自动路径：
- 单测：`node tests/test_agent.js`（零依赖，快）
- 浏览器集成：`node tests/cdp/run-all.js`（自动拉起 headless Chrome 验证真实 DOM 与扩展注入；需本机有 Chrome）

- [ ] **Step 5: 提交**

```bash
git add tests/cdp/ .github/ README.md
git commit -m "test: unified browser test runner + CI workflow"
```

---

### Task 5: 真机回归验证（用测试页做真实 Agent 任务）

**Files:**
- Test: `tests/test-page.html` 扩展的任务目标提示词（人工在侧边栏跑一次）
- 记录：本次回归的结论写入 README「已知验证」或本计划附录

- [ ] **Step 1: 在真机扩展跑一个端到端任务**

手动操作：`chrome://extensions` 重新加载扩展 → 打开侧边栏 → 目标输入「在搜索框输入 hello 并点击提交按钮」（沿用 README 示例）→ 观察 mio 规划、点击、输入、完成。
期望：规划器产出步骤、executor 依次执行、日志流着色正常、状态 pill 转 done。

- [ ] **Step 2: 记录回归结论**

若通过：README 增补一行「已用真实浏览器验证 test-page.html 任务（2026-08-04）」。
若发现 bug：按 systematic-debugging 处理，修完补测试再回到本步骤。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs: note real-browser regression on test page"
```

---

## Self-Review

**Spec coverage:** 目标=自动化真实浏览器测试。Task1 建 CDP 基础（√）、Task2 真实 DOM content 逻辑（√，替代人工 browser-test.js）、Task3 扩展注入（√）、Task4 runner+CI（√）、Task5 真机回归（√）。缺项：无测试覆盖率统计——不引入依赖的前提下可用 `--coverage` 的 Node 内置单测替代，属后续 backlog，非本计划范围。

**Placeholder scan:** 无 TBD/TODO 占位；所有代码块完整。Task3 的注入标记依赖 content/main.js 现状，用"检测既有副作用或加一行标记"明确兜底，非占位。

**Type consistency:** `connect/getBrowserWsUrl`（client.js）、`launchChrome`（launch.js）、`openTab/runInPage/report`（page-runner.js）、`loadExtensionHarness`（extension-harness.js）在后续任务中引用名与定义一致；`run-all.js` 依赖脚本文件名与 Task1-3 创建一致（smoke.js / run-page-tests.js / run-extension-tests.js）。
