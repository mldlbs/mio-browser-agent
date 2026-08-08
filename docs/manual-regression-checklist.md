# 手动回归清单（v0.1.22）

> 在扩展侧边栏执行。每条记录：通过 / 失败 + 关键日志。
> 失败时把 onLog 输出贴回来。

## 准备

- [ ] 扩展已加载并刷新，footer 显示 `v0.1.22`
- [ ] 设置里已填 Provider / API Key / Model（建议 openai 或兼容端点）
- [ ] 测试时关闭其它无关标签页，避免干扰

---

## 第一轮：基础链路（确认无回归）

### T1 · 搜索 + 提取
```
在必应搜索 "web agent 原理"，打开第一条结果，提取正文前 3 个要点。
```
- [ ] 日志有 `navigate`、`type`、`extract_text`
- [ ] 最终 URL 是落地页，非必应首页
- [ ] 提取 3 个要点，内容相关

### T2 · 纯打开步骤的 prompt 裁剪验证
```
打开 example.com 并确认页面加载出 "Example Domain" 字样。
```
- [ ] 日志**无** `read_captcha`、`图标按钮`、`发送未确认` 相关提示（说明 open 步骤没带无关规则）
- [ ] 页面打开后直接 finish，未做多余动作

---

## 第二轮：跨站 + 会话记忆（重点验证 memo）

### T3 · memo 跨 tab 保存/读取
```
在必应搜索 "openai"，把第一条结果标题用 memo 保存为 title。新开标签页打开 example.com，切回必应，从 memo 读取 title 并确认它等于当前第一条结果的标题。
```
- [ ] 日志出现 `memo → saved`（set 成功）
- [ ] 切页后 `memo get` 返回原值，非空
- [ ] 读到的值 = 页面实际标题，无虚构

### T4 · replan 后 memo 保留
```
在必应搜索 "mio browser agent"，把第一条结果标题 memo 保存为 title。然后点击一个不存在的元素（如 index 99）触发恢复，观察 replan 后仍能从 memo 读取 title。
```
- [ ] 日志出现「重新规划」
- [ ] replan 后 `memo get title` 返回原值
- [ ] replan 后未重新搜索（不重复提取已 memo 数据）

---

## 第三轮：表单 + 发送验证（有账号时）

### T5 · 发送验证闭环
```
在已登录的 DeepSeek 对话页，发送"用一句话解释什么是 Agent Runtime"，等回复后提取第一句话。
```
- [ ] 发送按钮只点 1 次
- [ ] 日志出现「发送已确认」
- [ ] 无 `SEND_NOT_VERIFIED` 恢复

---

## 第四轮：视觉兜底（需启用 Vision 设置）

### T6 · canvas 坐标点击
```
加载本地测试页 tests/test-page.html，点击页面中部的 canvas 验证码区域。
```
> 需在设置启用 Vision 并配 vision 模型。
- [ ] DOM 定位失败后恢复日志出现 `vision_locate`
- [ ] reason 含坐标（如 `(x, y)`）
- [ ] 出现 `click_at` 调用且成功

### T7 · 无坐标诚实降级
```
在 example.com，尝试点击一个页面不存在的按钮（如"右下角的关闭按钮"）。
```
- [ ] 视觉报告「不可见」
- [ ] 未编造坐标乱点
- [ ] 步骤诚实失败

---

## 记录

| # | 通过 | 失败 | 关键日志 / 失败信号 |
|---|------|------|--------------------|
| T1 |   |   |   |
| T2 |   |   |   |
| T3 |   |   |   |
| T4 |   |   |   |
| T5 |   |   |   |
| T6 |   |   |   |
| T7 |   |   |   |

## 失败信号速查

| 日志 | 含义 |
|------|------|
| `memo → saved` 后 `memo get` 为空 | memo 会话记忆失效，切页丢数据 |
| replan 后 `memo get` 丢失 | replan 上下文未带 notes |
| open 步骤日志出现 read_captcha/发送规则 | prompt 裁剪失效 |
| 视觉报可见但无坐标 | vision 坐标解析失败 |
| 视觉对不存在目标编造坐标 | vision 兜底误报 |
| `发送未确认` 误报 / 发送三连击 | send 验证 bug |
