# 表单自动填充（form_fill）设计文档

日期：2026-08-09
版本目标：v0.1.37

## 背景

当前登录/注册/搜索等高频表单场景需要 agent 逐字段 `type`（按 snapshot index）+ 单独点提交，慢且 agent 在字段匹配上易出错。目标：一次调用填完整表单，减少到 1-2 步。

## 设计目标

- `form_fill(fields, submit)` 一次调用批量填表
- 字段按语义匹配（精确 + 宽松两级同义词），零依赖
- 支持文本 / select 下拉 / checkbox 三类字段
- `submit: true` 时自动识别并点击提交按钮（多重信号）
- `type` 工具补 `field` 参数做单字段定位兜底

## 架构

```
common/fields.js        FIELD_SYNONYMS + matchField(fieldKey, el) 纯函数（可单测）
tools/form_fill.js      薄封装：fields + submit → content 侧 form_fill action
content/executor.js     新增 form_fill action：真实 DOM 匹配 + 批量填充 + 提交
tools/type.js           增强：支持 field 参数（sidepanel 侧 matchField → index）
```

匹配在 **content 侧真实 DOM** 做（能识别原生 `type=submit`、定位隐藏字段）。sidepanel 侧 `type` 的 field 参数用同一 `matchField` 定位到快照元素。

## 组件设计

### common/fields.js

- `FIELD_SYNONYMS`：同义词表
  - username → 用户名 / 账号 / 用户 / 登录名 / 账户 / 昵称
  - email → 邮箱 / 电子邮件 / 邮件
  - password → 密码 / 口令 / 登录密码
  - phone → 手机 / 手机号 / 电话 / 电话号码
  - city → 城市 / 地区
  - search → 搜索 / 查询 / 搜
  - confirm → 确认密码 / 重复密码
  - 等常用字段
- `matchField(fieldKey, el)`：输入归一化形状 `{ name, placeholder, role, value }`
  - 精确：fieldKey 子串命中 name 或 placeholder（不区分大小写）
  - 宽松：fieldKey 的同义词命中 name 或 placeholder
  - 返回匹配质量（exact / synonym / none）
- 纯函数，无 DOM 依赖，可单测

### form_fill 工具

```json
{
  "fields": { "username": "alice", "city": {"select": "上海"}, "agree": true },
  "submit": true
}
```

- 文本值 → 填 input/textarea/contenteditable（复用 `type` 逻辑）
- `{select: "选项文本"}` → select 下拉选项文本匹配（跳过 placeholder 空选项）
- boolean → checkbox checked
- 提交识别（多重信号，优先级从高到低）：
  1. form 内原生 `input[type=submit]` / `button[type=submit]`
  2. name 强关键词：登录 / 注册 / 提交 / sign in / submit / 下一步
  3. 输入框近距图标按钮兜底
  - 发送类弱关键词（发送 / 确定 / 完成）需表单上下文（表单内多字段）才匹配，避免误点聊天发送

### type 工具增强

- 支持 `field` 参数：`type(field: "username", text: "alice")`
- sidepanel 侧用 `matchField` 在快照元素中定位，转 index 走现有 `type` action
- `index` 与 `field` 二选一，两者都传时报参数错误

## 数据流

```
agent 调用 form_fill
  → sidepanel tools/form_fill.js 薄封装
  → bridge.executeAction({ name: "form_fill", args: { fields, submit } })
  → content executor 匹配真实 DOM 字段
  → 逐字段填充 / 提交
  → 返回明细 { ok, fields: { key: "filled" | "not_found" }, submitted }
```

## 错误处理

- 某 key 找不到 → `FIELD_NOT_FOUND`，列出已填 / 未填 key，已填内容保留
- 找不到提交按钮 → `SUBMIT_NOT_FOUND`，已填字段保留，agent 自己点
- 部分成功返回详细明细（每 key 成功 / 失败）
- 空 fields / 全失败 → 明确错误，走恢复链（重试快照）

## 测试

- 单测（tests/test_agent.js）：
  - matchField 精确 / 宽松 / 无命中
  - FIELD_SYNONYMS 覆盖常用字段
  - form_fill 部分成功返回明细
  - 提交识别优先级（原生 > 强关键词 > 近距图标）
  - type 工具 field 参数（含 index+field 冲突报错）
- CDP（tests/test-page.html + run-page-tests.js）：
  - 真实表单（用户名 / 密码 / 城市 select / 同意 checkbox / 提交按钮）
  - form_fill 一次填完 + submit，断言 DOM 状态
  - 字段找不到 → FIELD_NOT_FOUND

## 版本

bump manifest → **0.1.37**
