# 失败透明度事件流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 executor 内置步骤事件流，按步骤结构化呈现失败叙事（原因/恢复/结果），计划面板可展开回看，历史记录可持久化。

**Architecture:** executor.js 创建追加式 `stepEvents` 数组，各事件点（步骤生命周期/恢复/失败工具调用）push，`execute` 返回带回。UI 在计划面板失败步骤展开渲染；history.js 持久化 stepEvents。顺修 agent-runtime 未转发 onCheckpoint、recoveries 计数恒 0 两个数据源 bug。

**Tech Stack:** 原生 JS（Chrome 扩展 content/background/sidepanel），零第三方依赖。测试：Node 单测 `tests/test_agent.js`。

**测试命令：**
- 单测：`node tests/test_agent.js`（期望 `=== ALL PASS ===`）

---

### Task 1: executor.js 事件流

**Files:**
- Modify: `sidepanel/executor.js`
- Test: `tests/test_agent.js`

- [ ] **Step 1: 写失败测试**

在 `tests/test_agent.js` 现有 executor 测试区（`failLlm`/`res2` replan 测试之后，约 :873 之后）插入：

```js
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
  assert(evRes.events.some((e) => e.type === "recovery" && e.code === "ELEMENT_NOT_FOUND"), "events contain recovery for failed tool");
  assert(evRes.events.some((e) => e.type === "recovery" && e.attempts && e.attempts.length > 0), "recovery event carries attempts");
  assert(evRes.events.some((e) => e.type === "recovery" && e.outcome === "exhausted"), "recovery event carries exhausted outcome");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`evRes.events` 为 undefined

- [ ] **Step 3: 实现 executor.js**

**3a.** `execute()`（:732）创建 `stepEvents`，在 `runCtx` 上挂载。找到 `const runCtx = Object.assign({}, ctx, { history, plan, goal: plan.goal });`（:738）后面加：

```js
  const stepEvents = [];
  runCtx.stepEvents = stepEvents;
```

**3b.** `execute()` 返回带 `events`。末尾 `return { ok: true, summary: lastSummary || "所有步骤完成" };`（:832）改为：

```js
  return { ok: true, summary: lastSummary || "所有步骤完成", events: stepEvents };
```

同时 `execute` 内所有提前 return（:770 stopped、:774 maxSteps、:806 replans 超限）也带上 `events: stepEvents`。

**3c.** 步骤生命周期事件。主循环 `const step = plan.steps[current];`（:777）后加：

```js
    stepEvents.push({ type: "step_start", stepIndex: current, description: step.description });
```

步骤成功处（:793 `ctx.onLog("step", "DONE: ...")` 之后）加：

```js
    stepEvents.push({ type: "step_done", stepIndex: doneIndex, summary: result.summary || "" });
```

步骤失败处（:799 `emitProgress("failed", ...)` 之后）加：

```js
    stepEvents.push({ type: "step_failed", stepIndex: current, error: result.error || "", errorCode: result.errorCode || "" });
```

replan 处（:819 `ctx.onLog("plan", ...)` 之后）加：

```js
    stepEvents.push({ type: "replan", stepIndex: current, description: step.description, failedError: result.errorCode || "", failedReason: (result.error || "").slice(0, 300) });
```

**3d.** 恢复事件入流——handleRecovery 的 emit 闭包改双写。找到 `const emit = (ev) => ctx.onRecovery && ctx.onRecovery(ev);`（:416）改为：

```js
  const emit = (ev) => {
    if (ctx.onRecovery) ctx.onRecovery(ev);
    if (ctx.stepEvents) ctx.stepEvents.push(Object.assign({ type: "recovery", stepIndex: ctx.currentStepId }, ev));
  };
```

**3e.** 失败工具调用入流。工具失败处理处 `if (!result.ok) {`（:366）内、`const errorInfo = {...}` 之前加：

```js
        if (ctx.stepEvents) {
          ctx.stepEvents.push({ type: "tool_failed", stepIndex: ctx.currentStepId, name: tc.name, error: result.error || "", errorCode: result.errorCode || "" });
        }
```

（SEND_NOT_VERIFIED 分支 :325 调用 handleRecovery 前不单独加——recovery 事件已覆盖。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含新 5 条事件流断言

- [ ] **Step 5: 提交**

```bash
git add sidepanel/executor.js tests/test_agent.js
git commit -m "feat(executor): 步骤事件流（失败透明度数据源）"
```

---

### Task 2: agent-runtime.js 补 onCheckpoint 转发

**Files:**
- Modify: `sidepanel/agent-runtime.js`
- Test: `tests/test_agent.js`

- [ ] **Step 1: 写失败测试**

在 Task 1 新增断言之后插入：

```js
  // ── agent-runtime 转发 onCheckpoint（修复死回调）──
  const runtimeMod = require("../sidepanel/agent-runtime.js");
  const cpCaptured = [];
  const rt = runtimeMod.createAgentRuntime({
    settings: {}, bridge: { snapshot: async () => ({ url: "u", title: "t", elements: [] }), executeAction: async () => ({ ok: true, value: "ok" }) },
    onLog: () => {}, onRecovery: () => {}, onState: () => {}, onProgress: () => {},
    onCheckpoint: (cp) => cpCaptured.push(cp),
    deps: { maxTurns: 2, maxStepRetries: 1, maxSteps: 5, notes: { createNotes: () => ({ size: 0, toJSON: () => ({}), get: () => null, set: () => {}, render: () => "" }) } },
  });
  const rtLlm = { generate: async () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }) };
  // 替换 runtime 内部的 llm：createAgentRuntime 默认用 createAdapter(settings)，无法 mock —— 需要注入
```

> **注意**：`createAgentRuntime` 的 `llm` 来自 `deps.llm || createAdapter(settings)`（agent-runtime.js:2）。测试要注入 llm 需通过 `deps.llm`。因此测试改为：

```js
  const runtimeMod = require("../sidepanel/agent-runtime.js");
  const cpCaptured = [];
  const rtLlm = { generate: async () => ({ content: "", toolCalls: [makeToolCall("finish", { summary: "done" })] }) };
  const rt = runtimeMod.createAgentRuntime({
    settings: {},
    bridge: { snapshot: async () => ({ url: "u", title: "t", elements: [] }), executeAction: async () => ({ ok: true, value: "ok" }) },
    onLog: () => {}, onRecovery: () => {}, onState: () => {}, onProgress: () => {},
    onCheckpoint: (cp) => cpCaptured.push(cp),
    deps: {
      llm: rtLlm,
      maxTurns: 2, maxStepRetries: 1, maxSteps: 5,
      notes: { createNotes: () => ({ size: 0, toJSON: () => ({}), get: () => null, set: () => {}, render: () => "" }) },
    },
  });
  const rtRes = await rt.run("g");
  assert(rtRes.ok, "agent-runtime runs task");
  assert(cpCaptured.length > 0, "agent-runtime forwards onCheckpoint callbacks", String(cpCaptured.length));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`cpCaptured.length === 0`

- [ ] **Step 3: 实现 agent-runtime.js**

`createAgentRuntime` 签名（:1）加 `onCheckpoint`：

```js
function createAgentRuntime({ settings, bridge, onLog = () => {}, onRecovery = () => {}, onCheckpoint = () => {}, onState = () => {}, onProgress = () => {}, deps = {} }) {
```

`executor.execute` 调用（:31-44）传 `onCheckpoint`：

```js
      const result = await executor.execute(planDoc, {
        llm, bridge, memory, notes, onLog, onRecovery, onCheckpoint, onProgress,
        ...
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含 onCheckpoint 转发断言

- [ ] **Step 5: 提交**

```bash
git add sidepanel/agent-runtime.js tests/test_agent.js
git commit -m "fix(runtime): 转发 onCheckpoint（修复死回调）"
```

---

### Task 3: history.js 持久化 stepEvents

**Files:**
- Modify: `common/history.js`
- Test: `tests/test_agent.js`

- [ ] **Step 1: 写失败测试**

在 Task 2 断言之后插入：

```js
  // ── history.js 持久化 stepEvents（含封顶）──
  const historyMod2 = require("../common/history.js");
  const manyEvents = Array.from({ length: 150 }, (_, i) => ({ type: "tool_failed", stepIndex: 0, name: "x" + i }));
  const norm = historyMod2.normalizeRecord({ id: "r1", goal: "g", logs: [{ tag: "tool", text: "ok" }], stepEvents: manyEvents });
  assert(Array.isArray(norm.stepEvents), "normalizeRecord keeps stepEvents");
  assert(norm.stepEvents.length === 100, "normalizeRecord caps stepEvents at 100", String(norm.stepEvents.length));
  const normEmpty = historyMod2.normalizeRecord({ goal: "g" });
  assert(Array.isArray(normEmpty.stepEvents) && normEmpty.stepEvents.length === 0, "normalizeRecord defaults stepEvents to []");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`normalizeRecord keeps stepEvents`

- [ ] **Step 3: 实现 history.js**

`normalizeRecord`（:4-19）加字段：

```js
    stepEvents: Array.isArray(r && r.stepEvents) ? r.stepEvents.slice(-100) : [],
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含 3 条 history 断言

- [ ] **Step 5: 提交**

```bash
git add common/history.js tests/test_agent.js
git commit -m "feat(history): 持久化步骤事件流（封顶 100）"
```

---

### Task 4: recovery-events.js 新增 renderStepFailure

**Files:**
- Modify: `sidepanel/recovery-events.js`
- Test: `tests/test_agent.js`

- [ ] **Step 1: 写失败测试**

在 Task 3 断言之后插入（recovery-events 现有测试在 :1332-1349 附近，可追加到那附近，但为连续放这里也可——注意模块在文件顶部已 require）：

```js
  // ── renderStepFailure：给定某步骤的 recovery 事件，渲染失败叙事 ──
  const recMod = require("../sidepanel/recovery-events.js");
  const stepRecovery = [
    { type: "recovery", stepIndex: 0, kind: "error", code: "ELEMENT_NOT_FOUND", message: "未找到元素" },
    { type: "recovery", stepIndex: 0, kind: "attempt", action: "retry_snapshot", reason: "重新获取页面快照", ok: true, attempt: 1 },
    { type: "recovery", stepIndex: 0, kind: "attempt", action: "vision_locate", reason: "视觉确认目标不可见", ok: false, attempt: 2 },
    { type: "recovery", stepIndex: 0, kind: "outcome", outcome: "exhausted" },
  ];
  const narrative = recMod.renderStepFailure(stepRecovery);
  assert(narrative.includes("ELEMENT_NOT_FOUND"), "renderStepFailure shows error code");
  assert(narrative.includes("retry_snapshot") && narrative.includes("✓"), "renderStepFailure shows success attempt");
  assert(narrative.includes("vision_locate") && narrative.includes("✗"), "renderStepFailure shows failed attempt");
  assert(narrative.includes("exhausted"), "renderStepFailure shows outcome");
  assertEq(recMod.renderStepFailure([]), "", "renderStepFailure empty returns empty string");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`renderStepFailure is not a function`

- [ ] **Step 3: 实现 recovery-events.js**

新增 `renderStepFailure(events)`（events 是某步骤的 recovery 事件数组，含 error/attempt/outcome 三种 kind）。先聚合再渲染：

```js
// Render a per-step failure narrative from a list of recovery events
// ({type:"recovery", kind:"error"|"attempt"|"outcome", ...}).
function renderStepFailure(events) {
  if (!events || !events.length) return "";
  const agg = startEvents();
  for (const ev of events) {
    if (ev.kind === "error") agg.stepId = ev.stepIndex;
    addEvent(agg, ev);
  }
  return renderEventStream(agg);
}
```

导出加 `renderStepFailure`（:45-48）：

```js
  module.exports = { startEvents, addEvent, renderEventStream, renderStepFailure };
```

浏览器分支同样加（:48）：

```js
  globalThis.RecoveryEventsModule = { startEvents, addEvent, renderEventStream, renderStepFailure };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node tests/test_agent.js`
Expected: `=== ALL PASS ===`，含 5 条 renderStepFailure 断言

- [ ] **Step 5: 提交**

```bash
git add sidepanel/recovery-events.js tests/test_agent.js
git commit -m "feat(recovery-events): renderStepFailure 步骤失败叙事渲染"
```

---

### Task 5: sidepanel.js UI（计划面板失败步骤展开）

**Files:**
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/sidepanel.html`（CSS）

- [ ] **Step 1: sidepanel.html 加 CSS**

在 `.plan-step` 相关 CSS（约 :291-315）后加：

```css
  .plan-step.failed { cursor: pointer; }
  .plan-step.failed:hover { background: rgba(243, 139, 168, 0.12); }
  .step-failure-detail { margin: 2px 0 6px 24px; padding: 6px 10px; background: rgba(243, 139, 168, 0.06); border-left: 2px solid #f38ba8; border-radius: 4px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; color: #cdd6f4; }
```

- [ ] **Step 2: 改 renderPlanPanel 支持展开**

`renderPlanPanel()`（:13-59）的步骤循环（:38-57）改为：失败步骤加 `data-step-index` 和点击展开逻辑。核心改动——在 `list.appendChild(row)`（:56）后加：

```js
    if (planProgress.failed.includes(i) && expandedFailureStep === i) {
      const detail = document.createElement("div");
      detail.className = "step-failure-detail";
      const events = (currentTask && currentTask.stepEvents || []).filter((e) =>
        e.type === "recovery" && e.stepIndex === i
      );
      const narrative = events.length
        ? RecoveryEventsModule.renderStepFailure(events)
        : "无恢复记录";
      detail.textContent = narrative;
      list.appendChild(detail);
    }
```

同时把 `row` 的创建处加点击事件（:44 `row.className = ...` 之后）：

```js
    if (planProgress.failed.includes(i)) {
      row.addEventListener("click", () => {
        expandedFailureStep = expandedFailureStep === i ? null : i;
        renderPlanPanel();
      });
    }
```

在模块顶部（:7 `_historyPage` 后）加状态：

```js
let expandedFailureStep = null;
```

- [ ] **Step 3: 改 onRecovery handler 去重渲染**

`onRecovery` handler（sidepanel.js:474-486）改为：累积事件但只 append 一行摘要，不再每次创建完整卡片：

```js
    onRecovery: (ev) => {
      if (!currentTask) return;
      currentTask.recoveryEvents = RecoveryEventsModule.addEvent(currentTask.recoveryEvents, ev);
      if (ev.kind === "error") {
        appendLog("recover", `步骤 ${(typeof ev.stepId === "number" ? ev.stepId + 1 : ev.stepId)} ❌ ${ev.code}${ev.message ? ": " + ev.message : ""}`);
      } else if (ev.kind === "outcome" && ev.outcome === "exhausted") {
        appendLog("recover", "✗ 恢复用尽，步骤失败（点击计划面板失败步骤查看详情）");
      }
    },
```

- [ ] **Step 4: 改保存流程**

运行时完成后（sidepanel.js:513-519 附近，`currentTask.recoveries = m.recoveryCount || 0;` 处）改为：

```js
    currentTask.status = result.ok ? "done" : "error";
    currentTask.stepEvents = (result && result.events) || currentTask.stepEvents || [];
    currentTask.recoveries = currentTask.stepEvents.filter((e) => e.type === "recovery" && e.kind === "error").length;
    currentTask.replans = currentTask.stepEvents.filter((e) => e.type === "replan").length;
    currentTask.finishedAt = Date.now();
```

（`m` metrics 变量不再用于 recoveries——如无其它用途可移除该变量。）

- [ ] **Step 5: 改 historyLog**

`historyLog()`（:262-269）当前把 recoveryEvents 渲染成一条文本日志。stepEvents 已结构化入库，改为只加 debug 行（recover 行去掉或保留但基于 stepEvents）：

```js
async function historyLog(goal) {
  if (!currentTask) return;
  currentTask.logs.push({ tag: "debug", text: "目标: " + goal, ts: Date.now() });
  await HistoryModule.addHistoryRecord(currentTask);
  currentTask = null;
}
```

- [ ] **Step 6: 验证**

Run: `node tests/test_agent.js` → `=== ALL PASS ===`

> sidepanel.js 无 DOM 测试基础设施（explore 确认），此步以单测无回归 + 手动验证为主。手动验证步骤：加载扩展 → 跑一个会失败的任务 → 计划面板失败步骤可点击展开显示恢复叙事 → 历史记录回看也显示。

- [ ] **Step 7: 提交**

```bash
git add sidepanel/sidepanel.js sidepanel/sidepanel.html
git commit -m "feat(sidepanel): 计划面板失败步骤展开失败叙事"
```

---

### Task 6: bump 0.1.42 + 回归文档

**Files:**
- Modify: `manifest.json`（0.1.41 → 0.1.42）
- Modify: `docs/test-prompts.md`

- [ ] **Step 1: bump 版本**

```bash
# manifest.json version 0.1.41 -> 0.1.42（Python 修改，ensure_ascii=False, indent=2）
```

- [ ] **Step 2: 更新回归文档**

`docs/test-prompts.md` 新增「场景九：失败透明度」：

```
### 任务 1 · 失败步骤叙事展示

```
打开任意含表单的页面，要求 mio 点击一个 DOM 快照里不存在的元素（如"右下角不存在的按钮"），观察失败后计划面板的失败步骤能否展开显示恢复过程。
```

**验收标准**：失败步骤可点击展开；叙事含错误码、恢复动作（✓/✗）、最终结果；历史记录回看也能看到。
```

回归速查表补一行：

```
| 失败透明度 | 1 失败叙事 | 计划面板展开恢复过程 | ⭐⭐⭐⭐ |
```

- [ ] **Step 3: 提交**

```bash
git add manifest.json docs/test-prompts.md
git commit -m "chore: bump version to 0.1.42 + 回归集补失败透明度场景"
```

- [ ] **Step 4: 全量验证**

Run: `node tests/test_agent.js` → `=== ALL PASS ===`

---

### Task 7: 同步 agent-dev 镜像 + push（交付）

**Files:**
- Copy: browser-agent 变更文件 → `E:\work\code\agent-dev\chrome-ext-agent\`

- [ ] **Step 1: 同步变更文件**

```powershell
$files = @(
  'sidepanel/executor.js','sidepanel/agent-runtime.js','sidepanel/recovery-events.js',
  'sidepanel/sidepanel.js','sidepanel/sidepanel.html',
  'common/history.js','manifest.json',
  'tests/test_agent.js','docs/test-prompts.md',
  'docs/superpowers/specs/2026-08-10-failure-transparency-design.md'
)
foreach ($f in $files) {
  $dst = "E:\work\code\agent-dev\chrome-ext-agent\$f"
  if (Test-Path -LiteralPath (Split-Path -Parent $dst)) { Copy-Item -Force "E:\work\code\browser-agent\$f" $dst }
  else { Write-Output "SKIP: $f" }
}
```

- [ ] **Step 2: 提交 agent-dev**

```powershell
git -C E:\work\code\agent-dev\chrome-ext-agent add -A
git -C E:\work\code\agent-dev\chrome-ext-agent commit -m "feat: 失败透明度事件流 + bump 0.1.42"
```

- [ ] **Step 3: push browser-agent main**

```powershell
git -C E:\work\code\browser-agent push origin main
```

- [ ] **Step 4: 汇报**

汇总：提交列表、测试结果、版本号；询问是否发布 v0.1.42（按新规则需用户确认）。
