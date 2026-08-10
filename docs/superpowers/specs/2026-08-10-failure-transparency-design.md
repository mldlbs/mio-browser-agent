# 失败透明度事件流 — 设计文档

日期：2026-08-10
范围：`sidepanel/executor.js`、`sidepanel/agent-runtime.js`、`sidepanel/recovery-events.js`、`sidepanel/sidepanel.js`、`common/history.js`、测试

## 背景与目标

用户信任 agent 的前提是看懂「为什么失败、做了哪些恢复、恢复成功/失败」。现有实现只有双轨出口：
- `onLog(tag, text)` 字符串日志（无结构化数据）
- `onRecovery(ev)` 聚合对象（`{stepId, errorCode, message, attempts, outcome}`，recovery-events.js）

缺陷：
1. **无追加式结构化事件流**——无法按步骤回看失败叙事
2. **恢复事件不结构化入库**——history.js 的 `normalizeRecord` 丢弃 recoveryEvents，`historyLog()` 只渲染成一条文本日志
3. **数据源 bug**：`agent-runtime.js` 未转发 `onCheckpoint`（sidepanel.js:487 死回调）；`recordRecovery`/`recordFinishFailed` 从未被 executor 调用（metrics.recoveryCount 恒 0，sidepanel.js:517 `recoveries` 不可信）

**目标**：以「步骤」为单位结构化呈现失败叙事：步骤 → 失败原因 → 恢复动作序列 → 结果。在计划面板展开，历史记录可回看。

**明确不做**：全量执行事件流（每个 tool call 都入库）；修改 closed shadow；云同步。

## 方案选择

- **executor 内置事件流（采用）**：executor 内追加式 `ctx.stepEvents` 数组，各事件点 push，`execute` 返回带回。最完整准确，顺带修复数据源 bug。
- 备选（舍弃）：sidepanel 层重建（onLog 是字符串，叙事丢结构化细节）；扩展 onRecovery（依赖回调丰富度）。

## 设计

### 架构

新增 executor 内置的追加式步骤事件流（`ctx.stepEvents`），记录结构化事件，随 `execute` 返回带回。

事件类型：

```js
{ type: "step_start",  stepIndex, description }
{ type: "step_done",   stepIndex, summary }
{ type: "step_failed", stepIndex, error, errorCode }
{ type: "recovery",    stepIndex, code, message, attempts: [{action, reason, ok}], outcome }  // 失败叙事主体
{ type: "replan",      stepIndex, description, failedError, failedReason }
{ type: "tool_failed", stepIndex, name, error, errorCode }  // 仅失败工具调用
```

**消费方**：
- UI：`renderPlanPanel` 失败步骤可点击展开，渲染该步骤 recovery 事件（原因/动作/结果）
- 历史：`common/history.js` `normalizeRecord` 保留 `stepEvents`（封顶 slice(-200)）
- sidepanel.js：`onRecovery` 去重渲染（只 append 一行摘要），完整叙事在计划面板展开

**顺修数据源 bug**：
- `agent-runtime.js` 补 `onCheckpoint` 转发
- `recoveries` 计数从 stepEvents 统计（取代恒 0 的 metrics.recoveryCount）

### 各层改动

**sidepanel/executor.js**
- `execute()` 创建 `stepEvents = []`，emit 闭包双写：
  ```js
  const emit = (ev) => {
    if (ctx.onRecovery) ctx.onRecovery(ev);
    if (ctx.stepEvents) ctx.stepEvents.push(Object.assign({ stepIndex: ctx.currentStepId }, ev));
  };
  ```
- 步骤生命周期事件（execute 主循环）：
  - 进入步骤 → `step_start`
  - 成功 → `step_done`
  - 失败 → `step_failed`
  - replan → `replan`
- handleRecovery 的 emit 闭包改双写后，error/attempt/outcome 自动入流
- 失败工具调用（`!result.ok` 的工具结果）append `tool_failed`
- `execute` 返回 `{ ok, summary, resume, events: stepEvents }`

**sidepanel/agent-runtime.js**
- `createAgentRuntime` 解构加 `onCheckpoint`
- `executor.execute` 调用传 `onCheckpoint`

**common/history.js**
- `normalizeRecord` 新增 `stepEvents: Array.isArray(r.stepEvents) ? r.stepEvents.slice(-100) : []`

**sidepanel/recovery-events.js**
- 新增 `renderStepFailure(events)` 纯函数：给定某步骤的 recovery 事件列表，输出失败叙事文本（复用 renderEventStream 的聚合逻辑）

**sidepanel/sidepanel.js**
- `renderPlanPanel` 失败步骤可点击展开（`.step-failure-detail`），渲染该步骤失败叙事
- `onRecovery` handler 改为：累积事件 + append 一行摘要，不再每次创建完整 recovery-event 卡片
- 保存流程：`currentTask.stepEvents = result.events || []`；`recoveries = stepEvents.filter(type==="recovery" && kind==="error").length`
- `historyLog()` 移除或兼容（数据源改 stepEvents）

### 错误处理与边界

- `stepEvents` 为空 → 展开区显示「无恢复记录」，不报错
- 历史记录无 stepEvents（旧版本）→ 兼容显示「该记录无详细事件」
- `stepEvents` 封顶 slice(-200)（execute 返回时 + normalizeRecord 时）
- 展开/收起：点击切换，同时只展开一个
- replan 后步骤索引变化：stepEvents 用记录时的 stepIndex；replan 事件保留 old/failedError/failedReason，展开区可查

### 测试

**单元测试（tests/test_agent.js）**
- executor：`execute` 返回的 `result.events` 含 step_start/step_done/step_failed/recovery/replan 事件（mock llm+bridge 跑含失败步骤的 plan）
- 恢复事件入流：mock ELEMENT_NOT_FOUND 触发 handleRecovery，断言 stepEvents 含 recovery error/attempt/outcome
- history.js：normalizeRecord 保留 stepEvents（含封顶）
- agent-runtime：onCheckpoint 转发（mock 验证回调被调用）
- recovery-events：renderStepFailure 纯函数

**CDP**：sidepanel UI 无 DOM 测试基础（explore 确认 sidepanel.js 不在测试加载），以单测 + 手动回归为主。

## 实现顺序（提交粒度）

1. executor.js 事件流 + 单测
2. agent-runtime.js 补 onCheckpoint 转发 + 单测
3. history.js 持久化 stepEvents + 单测
4. sidepanel.js UI（失败步骤展开 + onRecovery 去重 + recoveries 统计）
5. bump 0.1.42 + 回归文档（test-prompts 加「失败透明度」场景）
6. 同步 agent-dev + push main（发布与否经用户确认）
