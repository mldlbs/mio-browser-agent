# mio Roadmap

产品路线图。按优先级驱动，随版本持续维护；各功能的详细设计分别落到对应的设计文档 / ADR。

## 优先级总览

| 优先级 | 功能 | 原因 |
| --- | --- | --- |
| ⭐⭐⭐⭐⭐ | DOM 覆盖扩展 ✅ | 直接提升任务完成率 |
| ⭐⭐⭐⭐⭐ | 失败透明度 ✅ | 建立 Agent 信任 |
| ⭐⭐⭐⭐ | 多页上下文 ✅ | 解锁复杂任务 |
| ⭐⭐⭐⭐ | 停止 / 续跑 ✅ | 长任务体验提升 |
| ⭐⭐⭐ | 历史记录增强 ✅ | 产品体验完善 |
| ⭐⭐ | Provider 抽象 ✅ | 按需求推进 |
| ⭐⭐ | 计划可视化 ✅ | 有帮助但非核心 |
| ⭐ | Vision 兜底 ✅ | 最后作为恢复兜底层 |
| 信号驱动 | 云同步 | 用户需求出现再做 |
| 信号驱动 | 任务分享 ✅（基础版） | 社区成熟后 |
| 信号驱动 | 模板市场 ✅（本地起步） | 最后阶段 |

---

## P0 · 下一版本（必须）

### DOM 覆盖扩展

当前 Browser Agent 最大瓶颈不是 UI，而是**完成率**。iframe、Shadow DOM、新标签页是现代网站高频场景（Gmail、Notion、Figma、飞书、GitHub、淘宝等），不支持意味着很多任务直接失败。

**范围**
- iframe 内元素（跨 document snapshot / 定位 / 执行）
- Shadow DOM（open shadow root 穿透）
- 打开新窗口 / 新标签页的目标迁移

### 失败透明度

Agent 可信度来自：为什么失败、做了哪些恢复、为什么恢复成功/失败。

建议不只是日志，而是**事件流**结构：

```text
Step 5 点击"登录"

❌ 未找到元素
原因：
DOM 已更新

恢复：
✓ 重新获取页面快照
✓ 重新定位按钮

结果：
✓ 找到新的按钮，继续执行
```

这是 Agent UX 非常重要的一环。

---

## P1 · 随后做

### 多页上下文 ✅

浏览器 Agent 与 Workflow Agent 的分水岭。例如：

- 淘宝复制商品标题 → 京东搜索
- GitHub 看 Issue → 回 PR
- 邮件复制验证码 → 登录页面输入

**设计**：以 `BrowserContext` 为模型，而非单一 `currentPage`：

```text
BrowserContext
    tabs
    activeTab
    memory
```

**已实现**：`tab` 工具（open/list/switch/close）；snapshot 携带 tabs 全景（`tabIndex`/`tabCount`/`Tabs:` 列表行）；跨 tab diff 抑制（导航不误报 DOM 变更）；Prompt 跨页指导。

**v0.1.15+ 补充 —— 会话记忆（memo）**：`memo` 工具（set/get/list/clear/remove）让 Agent 显式保存跨页数据（验证码、价格、提取的 id），在标签页切换、replan、长任务 history 裁剪后仍可读取；每轮快照消息注入 `Session notes`；checkpoint/resume 携带 notes（停止续跑不丢数据）；replan 上下文包含已收集数据（不重复提取）。planner 感知跨站任务（`PLAN_PROMPT` 引导「源站提取 → memo → 目标站使用」）。真机验证通过（邮箱验证码→登录、跨 tab 标题搬运、replan 后 memo 保留）。

### 停止 / 续跑 ✅

停止时不只告知「完成 8/12 步」，还应保存 `resumeToken`；恢复时提供「继续上次任务」，Agent 可直接从断点继续。

**已实现**：executor 每步成功后发 `onCheckpoint`；停止时返回 `resume` 断点（goal/plan/nextStepIndex）；历史记录保存断点并提供「继续」按钮，从断点步续跑。

---

## P2

### 历史记录增强 ✅

产品体验向。建议增加：收藏、Tag、搜索、Replay、导出 JSON。

不做数据库，JSON 足够。

**已实现**：收藏（★ 置顶排序）、Tag（每条记录 + 标签，可搜索命中）、搜索（目标/摘要/标签过滤）、重跑（重新执行同目标）、导出 JSON 下载。

**v0.1.19+ 补充**：导入 JSON（合并去重，id 去重 + 50 条上限）；单条任务分享（`buildShareRecord`——剥离 resume/notes 防凭据泄漏，日志封顶 300 条，导出为独立 JSON）；手动回归清单（`docs/manual-regression-checklist.md`）与实机回归场景集（`docs/test-prompts.md`）。

### Provider 抽象 ✅

保持 Adapter 即可，**不为了支持更多 Provider 再抽一层**。

**已实现**：`llm/adapter.js` 注册表 + `registerProvider`；`openai`/`deepseek`（OpenAI 兼容端）原生支持；`anthropic`（Claude Messages API，v0.1.17）——system 提升为顶层字段、tool_calls→tool_use、role:tool→tool_result、base64 图片→source 块、x-api-key 头。设置里 Provider 自由文本填 `anthropic` 即用。

---

## P3

### 计划可视化 ✅

有价值但收益有限。比起「Step 3」，用户更关心「Agent 为什么卡住」。排后。

**已实现**：侧边栏执行计划面板——步骤列表实时渲染，当前步 ▶ 高亮脉冲、完成 ✓ 绿、失败 ✗ 红；重规划时面板标记「已重规划」并重置。

---

## P4

### Vision 兜底 ✅

目前不建议作为默认流程。原因：图片 Token 成本高、延迟增加、Prompt 更复杂、调试难、与「零依赖、纯本地」定位冲突。

仅在 DOM 覆盖率足够高后，作为恢复引擎的**最后一层兜底**：

```text
DOM
    ↓
Accessibility
    ↓
OCR
    ↓
Vision
```

**已实现（v0.1.16 - v0.1.31，真机验证通过）**：

- 可选 `enableVision` 开关（默认关闭）
- **被动兜底**：DOM 恢复动作（重试快照/滚动）耗尽时，恢复引擎选取 `vision_locate`——`bridge.capture()` 截取当前页 → 视觉 LLM 确认目标可见性 → 可见则返回中心坐标；优先级位于 DOM 动作之后、最终放弃之前
- **主动定位工具 `find_by_vision`（v0.1.30）**：目标在 DOM 快照中缺失但视觉可见时，Agent 主动调用并拿到精确坐标，再用 `click_at` 点击。关闭了「DOM 找不到 → extract_text 蒙混 / 盲点坐标」的死角
- **坐标点击 `click_at`（v0.1.16+）**：按视口坐标派发完整鼠标 + pointer 事件序列，绕过 DOM 定位，命中 canvas/overlay/现代前端（pointer events 监听）
- **可靠性打磨**（v0.1.28 - v0.1.31，来自实机回归）：
  - scroll 到底/顶返回 `SCROLL_AT_END`，杜绝盲滚死循环
  - 同坐标重复点击无页面变化 → `CLICK_AT_UNVERIFIED` 走恢复链，杜绝盲点坐标
  - vision prompt 改为强格式一行坐标输出，坐标对覆盖模型「遮挡/跳转」误报措辞

---

## 执行质量增强（实机回归沉淀）

> 来自实机回归测试发现的稳定性问题与修复，直接提升任务完成率。版本区间 v0.1.14 - v0.1.31。

| 问题 | 修复 | 版本 |
|------|------|------|
| 新标签页（chrome://）启动时 navigate 静默失败，快照卡旧页 | 浏览器级导航 `bridge.navigate`（chrome.tabs.update），不依赖 content script | v0.1.23 |
| 提取+memo 步骤被 `STEP_NOT_VERIFIED` 误判「无动作」而重复执行 | `_stepActions` 统计所有成功工具（含只读 extract/memo） | v0.1.24 |
| 恢复事件步骤号 0-based 显示（步骤 3 显示「步骤 2」） | 渲染改为 1-based；string stepId 保持原样 | v0.1.25 |
| 发送后页面重渲染导致按钮 index 变化，重复点击守卫失效（重复发送） | duplicate-click guard 改用稳定元素 name 作 key | v0.1.26 |
| vision 坐标点击对 pointer events 监听的现代 UI 无效 | `clickAt` 补派发 pointerdown/pointerup | v0.1.27 |
| Agent 为找快照外元素盲滚到 50 万像素死循环 | scroll 到底/顶返回 `SCROLL_AT_END` | v0.1.28 |
| Agent 用 `click_at` 盲点坐标无限循环，不走恢复链 | 同坐标重复点击无页面变化 → `CLICK_AT_UNVERIFIED` | v0.1.29 |
| Agent 用 extract_text 找到文本就自认定位成功，跳过视觉 | 主动工具 `find_by_vision` 接管「快照缺失但可见」场景 | v0.1.30 |
| vision 模型对可见目标误报「被遮挡/跳转」 | 强格式坐标输出 + 坐标对覆盖遮挡措辞 | v0.1.31 |
| 任务模板（v0.1.21）：一键填充常用任务目标 | 模板市场本地起步 | v0.1.21 |
| 提示词按步骤类型裁剪（open/send/login/tab/extract） | `classifyStep` 动态注入 `{stepFocus}`，减少无关规则噪音 | v0.1.22 |

---

## 长期 · 信号驱动

### 云同步

等出现真实需求（如「我想换电脑」）再做。

### 任务分享

比模板市场更重要——天然形成「Task Definition → JSON → GitHub 分享」的社区闭环。

### 模板市场

目前过早。没有足够用户，就没有模板生态。
