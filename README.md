# mio 🐾

一个自然语言驱动的浏览器 Agent（Chrome 扩展）。告诉它你想做什么，mio 会像幽灵一样在网页上替你点击、输入、滚动、导航、提取内容——包括登录页验证码。

## ✨ 特性

- **自然语言任务**：输入目标，mio 自动规划步骤并执行，例如「在搜索框输入 hello 并点击提交按钮」
- **内置工具集**：`click`、`type`、`scroll`、`navigate`、`wait`、`extract_text`、`paste`、`tab`、`read_captcha`
- **验证码智能读取**：`read_captcha` 优先取 canvas 精确位图（`toDataURL`）喂给视觉模型，整页截图兜底；4 位结果校验，识别失败自动重试；点击验证码可刷新后重读
- **恢复引擎（Recovery Engine）**：动作失败时自动定位替代元素、回退重试、重新规划，而不是死磕到超时
- **步骤纪律**：逐条执行计划，每步完成后推进进度；确认/打开类步骤立即收尾，不越步执行
- **任务历史面板**：记录每次任务的目标/摘要/日志/断点，支持继续、回放、搜索、标签、置顶、导出 JSON
- **可收起 UI**：计划面板可折叠；侧边栏整体可收起（`chrome.sidePanel.close()`，释放右侧空间，点工具栏图标重新打开）
- **自愈式执行**：同一网页访问 LLM 可以记忆和复用（memory），跨页面保持上下文（runtime protocol / turn handler）
- **幽灵主题 UI**：深靛底 + 雾紫配色的侧边面板，日志按类型着色，footer 显示当前版本号，状态一目了然
- **纯零依赖**：不打包任何第三方库，全部手写 JS，可用 Node 直接跑单元测试

## 🚀 安装

1. 克隆仓库后，打开 `chrome://extensions`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本仓库目录（含 `manifest.json` 的那层）
4. 点开侧边面板即可使用（工具栏图标 → 面板；Chrome 141+ 支持面板内「收起」）

> 建议 Chrome 141+（`chrome.sidePanel.close()` 需要）。旧版本收起按钮会退化为 `window.close()`。

## 📖 使用

### 配置模型

在侧边面板「设置」中填写：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| Provider | 主模型供应商标识 | `openai` |
| Model | 主模型名 | `gpt-4o-mini` |
| Base URL | 主模型 API 地址 | `https://api.openai.com/v1` |
| API Key | 主模型密钥（明文存储于 `chrome.storage.local`，仅本机可见） | — |
| Max Steps | 单次任务最大步数 | `30` |
| Vision Model | 视觉模型名（独立配置，留空则复用主模型） | `glm-4v-flash` |
| Vision Base URL | 视觉模型 API 地址 | `https://open.bigmodel.cn/api/paas/v4` |
| Vision API Key | 视觉模型密钥 | — |
| Vision 兜底 | 勾选后启用视觉定位恢复（`vision_locate`），与验证码读取无关 | — |

### 运行任务

1. 在「任务目标」输入框描述目标，例如：`在搜索框输入 hello 并点击提交按钮`
2. 点击「开始任务」
3. 观察右侧日志流：`plan`（规划）→ `step`（执行）→ `tool`（工具调用）→ `finish`（完成）；计划面板同步标出每步状态（✓/✗/▶）
4. 任务进行中可随时「停止」；「历史」面板可继续、回放已完成任务

### 登录验证码场景

- 快照会把验证码 canvas/img 命名为「验证码(hint)」；模型识别后调用 `read_captcha` 读取
- `read_captcha` 有 4 位字符校验，读错/不可读会自动重试或提示点击验证码刷新
- 视觉读取必须填 Vision Model + Vision Base URL + Vision API Key（三者齐全才生效）

### 收起与折叠

- **计划面板**：面板标题右侧 `▾/▸` 折叠步骤列表，给日志让位
- **整个侧边栏**：header 右侧「收起」按钮关闭侧边栏（任务会先停止并保存断点），需要时点工具栏图标重新打开

## 🏗️ 架构

```
manifest.json                 扩展入口与权限
background/service-worker.js  Service Worker 生命周期（openPanelOnActionClick）
sidepanel/                    侧边面板 UI + Agent 运行时
  sidepanel.html/js           界面与事件绑定（含历史面板、收起/折叠）
  bridge.js                   与 content script 通信的页面桥
  planner.js                  任务 → 步骤规划
  memory.js                   页面访问记忆
  executor.js                 单步执行循环（步骤纪律、纠正注入）
  agent-runtime.js            Agent 总调度
  recovery-*.js               恢复引擎（context/policy/engine/result）
  runtime-protocol.js         LLM ↔ 动作协议
  turn-handler.js             对话轮次管理
  vision.js                   视觉模型调用（验证码/定位兜底）
  metrics.js                  执行指标统计
content/                      注入页面的脚本
  snapshot.js                 页面状态快照（元素、可交互节点、验证码命名）
  locator.js                  选择器定位与多候选回退
  executor.js                 页面内动作执行（click/type/…/readCanvasBitmap）
  main.js                     content script 入口（消息分发）
tools/                        工具定义与注册（registry.js）
  read_captcha.js             验证码位图读取（canvas 优先 + 截图兜底 + 4 位校验）
common/                       共享协议、存储、日志
llm/                          LLM 适配层（openai 兼容）
tests/                        单元测试（Node 直接运行）+ CDP 浏览器集成
docs/                         architecture.md（架构冻结）、test-prompts.md（人工回归集）、roadmap.md
```

数据流：`sidepanel/planner.js` 规划 → `agent-runtime.js` 循环调用 `executor.js` → `bridge.js` 通知 `content/main.js` 执行 → 快照回传 → `turn-handler.js` 组装新一轮 LLM 请求 → 直至任务完成或恢复引擎接管。

## 🧪 测试

零依赖，有两条自动路径：

**单测**（快，覆盖核心逻辑）：

```bash
node tests/test_agent.js
```

用例覆盖：快照构建（含验证码元素命名）、元素定位回退、工具注册、规划器、恢复引擎（重试/替代元素/重新规划）、运行时协议与 LLM 动作解码、read_captcha 位图优先与 4 位校验、步骤推进纪律。

**浏览器集成测试**（自动拉起 headless Chrome，在真实 DOM 上验证 content 逻辑）：

```bash
node tests/cdp/run-all.js
```

依次运行：CDP 冒烟探针 → 真实 DOM 断言（snapshot/locator/executor 在 test-page.html 上执行，含 canvas 验证码定位/点击/位图读取）→ 扩展注入探测。

说明：
- 浏览器测试需本机安装 Chrome（或设置 `CHROME_PATH` 环境变量指向 chrome.exe）
- 扩展的 content script 注入在 CDP 自动化 + 临时 profile 下暂不受支持（Chrome 已知限制），该 suite 会打印原因并优雅跳过（退出码 0）
- CI（GitHub Actions）会自动跑这两条路径，见 `.github/workflows/test.yml`

真机人工回归：见 [`docs/test-prompts.md`](docs/test-prompts.md)（4 场景 8 任务，含任务目标/验收标准/失败信号，覆盖导航+搜索+提取、表单+发送验证、慢加载恢复、多标签协作、登录验证码）。

## 📚 文档

- [`docs/architecture.md`](docs/architecture.md)：架构冻结与差距分析（Phase A/B/C 演进路线）
- [`docs/test-prompts.md`](docs/test-prompts.md)：功能测试通用提示词回归集
- [`docs/roadmap.md`](docs/roadmap.md)：按优先级 P0-P4 + 信号驱动

## 📦 版本

| 版本 | 内容 |
| --- | --- |
| 0.1.0 | 首个可用版本 |
| 0.1.1 | footer 显示扩展版本号 |
| 0.1.2 | 快照收录验证码 img/canvas 并命名 |
| 0.1.3 | 提示词引导模型使用 read_captcha |
| 0.1.4 | read_captcha 改取 canvas 精确位图 + 4 位校验重试 |
| 0.1.5 | 步骤纪律：完成当前步才推进，禁止越步 |
| 0.1.6 | 计划面板可折叠 |
| 0.1.7 | 侧边栏整体收起（chrome.sidePanel.close） |

## 📄 License

[MIT](LICENSE)
