# mio Roadmap

产品路线图。按优先级驱动，随版本持续维护；各功能的详细设计分别落到对应的设计文档 / ADR。

## 优先级总览

| 优先级 | 功能 | 原因 |
| --- | --- | --- |
| ⭐⭐⭐⭐⭐ | DOM 覆盖扩展 | 直接提升任务完成率 |
| ⭐⭐⭐⭐⭐ | 失败透明度 | 建立 Agent 信任 |
| ⭐⭐⭐⭐ | 多页上下文 | 解锁复杂任务 |
| ⭐⭐⭐⭐ | 停止 / 续跑 | 长任务体验提升 |
| ⭐⭐⭐ | 历史记录增强 | 产品体验完善 |
| ⭐⭐ | Provider 抽象 | 按需求推进 |
| ⭐⭐ | 计划可视化 | 有帮助但非核心 |
| ⭐ | Vision 兜底 | 最后作为恢复兜底层 |
| 信号驱动 | 云同步 | 用户需求出现再做 |
| 信号驱动 | 任务分享 | 社区成熟后 |
| 信号驱动 | 模板市场 | 最后阶段 |

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

### 停止 / 续跑 ✅

停止时不只告知「完成 8/12 步」，还应保存 `resumeToken`；恢复时提供「继续上次任务」，Agent 可直接从断点继续。

**已实现**：executor 每步成功后发 `onCheckpoint`；停止时返回 `resume` 断点（goal/plan/nextStepIndex）；历史记录保存断点并提供「继续」按钮，从断点步续跑。

---

## P2

### 历史记录增强

产品体验向。建议增加：收藏、Tag、搜索、Replay、导出 JSON。

不做数据库，JSON 足够。

### Provider 抽象

保持 Adapter 即可，**不为了支持更多 Provider 再抽一层**。OpenAI Compatible 已覆盖绝大部分；Anthropic 等有真实需求再做。

---

## P3

### 计划可视化

有价值但收益有限。比起「Step 3」，用户更关心「Agent 为什么卡住」。排后。

---

## P4

### Vision 兜底

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

---

## 长期 · 信号驱动

### 云同步

等出现真实需求（如「我想换电脑」）再做。

### 任务分享

比模板市场更重要——天然形成「Task Definition → JSON → GitHub 分享」的社区闭环。

### 模板市场

目前过早。没有足够用户，就没有模板生态。
