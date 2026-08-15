# AGENTS.md — chrome-ext-agent 项目上下文

> 本文档为持久化的工作记忆（2026-08-14 会话保存），供后续会话直接读取，避免重复调研。

## 项目定位

- **mio**：自然语言驱动的浏览器 Agent Chrome 扩展（MV3），零依赖、纯手写 JS。
- **目标用户**：小白（非技术用户），一句话自动化重复网页操作。
- **核心差异化**：会干活的自愈型 Agent（Recovery Engine 失败自动换路径），非聊天助手。
- **不收费用**：先免费冲量 1000+ 用户（Chrome Web Store 已不支持新付费扩展）。
- **目标**：1000+ 用户 = 留存（任务记忆/定时任务/失败率优化）+ 传播（模板分享闭环）。

## 已实现功能（按实现顺序）

1. **「本页可做」任务推荐**：`common/suggest.js` 纯启发式（零 LLM 成本），快照元素→任务卡片；`bridge.snapshotPeek()` 轻量快照；tab 切换自动刷新。
2. **历史上限动态化**：`common/history.js` 登录（有 session.serverUrl）时 50→500 条。
3. **商店上架准备**：manifest 补 icons/homepage_url/default_locale，名称 `mio — Browser Agent`，PRIVACY.md 如实披露云同步（`sync.crlkcloud.cyou`），`tests/cdp/cws-screenshots.js` 生成商店截图。
4. **商店多语言**：`_locales/en` + `_locales/zh_CN`，`default_locale: zh_CN`。
5. **P0 修复（CSDN 类编辑器站点）**：`planner.splitStages()` 检测 goal 显式阶段标记防单步压扁；`fields.js` 加 `title` 语义键。
6. **任务记忆（P1，任务 2f364208 完成）**：`common/task-memory.js` 记录每域名跑过的任务（仅 goal + 域名，纯本地 chrome.storage.local 绝不同步云端）；推荐面板同域名高频任务置顶并标「常用」徽章；去重/频次排序/每域名 20 条/总 200 条上限；单测已覆盖。
7. **定时/周期任务（P1，任务 b5f05312 完成）**：`common/scheduler.js` 任务模型 + 调度纯函数（每日/每周/间隔，chrome.alarms 映射，浏览器重启自动恢复）；`background/service-worker.js` importScripts 加载完整 runtime 链（planner/executor/recovery/bridge），alarms 到点跑 goal，结果写历史 + 任务记忆 + badge（✗ 计数，无需 notifications 权限避免 CWS 重审）；`bridge.js` 支持固定 tabId（定时任务跑到目标标签页）；sidepanel 新增「⏰ 定时」配置面板（添加/立即执行/启停/删除）。单测覆盖调度逻辑。
8. **模板分享闭环（P2，任务 4415c305 完成）**：`templates.js` 新增 `buildShareTemplate`/`parseShareTemplate`（仅 goal + 占位符，无凭据/URL），内置模板库扩充高频场景（每日签到/价格监控/日报/抢课/读文章存笔记）；sidepanel 模板行每个 chip 带「↗ 分享」+ 尾部「＋ 导入模板」，历史任务「存模板」后询问复制分享、「模板分享」一键复制分享 JSON；往返单测覆盖。
9. **LLM 预设配置（P2，任务 688500d5 完成）**：`storage.js` 新增 `PROVIDER_PRESETS`（OpenAI/DeepSeek/智谱/月之暗面/Ollama 本地/LM Studio 本地/自定义）+ `findProviderPreset`/`isLocalProvider`/`resolveProviderSettings` 纯函数；sidepanel Provider 改下拉，选中自动填 Model+Base URL，自定义保留手填；API Key 留空仅本地 provider 允许（startTask 校验放宽）；设置页加「测试连接」按钮（POST /chat/completions 探测）；单测覆盖归一化。
10. **首次使用引导（P3，任务 dfb3745a 完成）**：sidepanel 首次打开显示一次性引导遮罩（3 步：打开网站 → 看「本页可做」→ 开始任务，高亮步骤动画 + 圆点进度）；「跳过」或「不再显示」（checkbox + 永久关闭，chrome.storage.local `mioOnboardingDone` 标记）；`storage.js` 加 `normalizeOnboarding` 纯函数可单测；纯 sidepanel 改动零权限。
11. **失败率优化（P1，任务 c82ccddf 完成）**：`common/error-msg.js` 错误码→小白中文（human/advice，20+ 错误码，`humanizeError`/`humanizeErrorFull`/`humanizeRecoveryEvents`）；`sidepanel/failure-stats.js` 从 history stepEvents 聚合 errorCode 频率 + 成功率统计（top3 定位，`topErrors`/`successRate`）；恢复策略 `ELEMENT_NOT_FOUND` 前置 `wait_and_retry`（页面瞬态渲染是 top1 失败），vision 兜底预算 +4 保证 last-resort 仍执行；UI：onRecovery 日志/计划面板/历史失败分析按钮全部人话化；SW 定时任务失败总结也人话化。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `common/suggest.js` | 本页可做推荐引擎（可单测） |
| `common/error-msg.js` | 失败提示人话化（错误码→中文，纯函数） |
| `common/storage.js` | 设置归一化 + PROVIDER_PRESETS（小白免配置） |
| `sidepanel/failure-stats.js` | 失败分析（errorCode 聚合 + 成功率，可单测） |
| `common/task-memory.js` | 任务记忆（每域名高频任务置顶，纯本地） |
| `common/scheduler.js` | 定时任务调度纯函数 + storage（可单测） |
| `common/fields.js` | 字段语义匹配（FIELD_SYNONYMS，含 title） |
| `common/history.js` | 历史记录 + 动态上限（SYNC_SESSION_KEY） |
| `common/templates.js` | 模板系统（内置+自定义，buildShareTemplate/parseShareTemplate 分享闭环） |
| `sidepanel/planner.js` | 规划器（splitStages 防单步压扁） |
| `sidepanel/bridge.js` | 页面桥（支持固定 tabId，定时任务用） |
| `background/service-worker.js` | alarms 定时触发 + 后台执行完整 runtime |
| `tests/cdp/cws-screenshots.js` | 商店截图生成 |
| `scripts/release.py` | 发布打包（build_zip/build_crx） |

## 测试命令

```bash
node tests/test_agent.js   # 单测（全绿基线）
node tests/test_sync.js    # 同步测试
node tests/cdp/run-all.js  # 浏览器集成测试
node tests/cdp/cws-screenshots.js  # 商店截图
```

## 商店发布状态（截至本次会话）

- 开发者账号已注册；描述修复 135→123 字符；zip 已重建含 _locales。
- **发布方联系邮箱需验证**（设置页），否则无法提交审核。
- 图片素材在 `D:\Users\gf1913\Temp\opencode\cws-assets\`（截图 1280x800 x5 + 推广图 + icon128-store.png 已转 RGB 无 alpha）。
- 文案模板在 `docs/cws-store-listing.md`。

## mio-taskhub 任务

已建 6 个 1000+ 用户路线图任务（project=chrome-ext-agent）：
- `2f364208` 任务记忆（P1，同域名高频任务置顶）
- `b5f05312` 定时/周期任务（P1，依赖任务记忆）
- `c4a97a5c` 失败率优化（P1，成功率 90%+）
- `4415c305` 模板分享闭环（P2）
- `688500d5` LLM 预设配置（P2）
- `dfb3745a` 首次使用引导（P3）

服务启动：`cd mio-taskhub && python -m uvicorn mio_taskhub.main:app --port 8080`

## 待办 / 未完成

- **任务记忆**（2f364208）：已完成，见「已实现功能」第 6 条。
- **定时任务**（b5f05312）：已完成，见「已实现功能」第 7 条。注意：SW 后台执行较长任务可能被 MV3 30s 空闲回收（已用 20s heartbeat 缓解）；定时任务用后台标签页（不抢焦点），badge 提示失败数。
- **模板分享闭环**（4415c305）：已完成，见「已实现功能」第 8 条。可选后续：二维码/短链（评估必要性，非必须）。
- **LLM 预设配置**（688500d5）：已完成，见「已实现功能」第 9 条。
- **首次使用引导**（dfb3745a）：已完成，见「已实现功能」第 10 条。
- **失败率优化**（c82ccddf）：已完成，见「已实现功能」第 11 条。注意：真实成功率数据需用户启用后从本地统计积累；当前用 tests/test-page.html + 模拟快照验证修复逻辑。
- **CSDN 发布回归**：P0 修复后需在真实 CSDN 编辑器重跑验证（paste 对 CodeMirror、find_by_vision 回退仍为 P1）。
- **商店审核**：等审核结果；邮箱验证未做。
- **README 商店安装按钮**：审核通过后补商店 URL。
- **全量回归（2026-08-15 会话）**：test_agent.js ALL PASS / test_sync 28 passed / cdp run-all 全绿 / 50 个 JS 文件语法 OK / manifest+sidepanel+SW 引用全部可解析 / SW importScripts 38 文件模拟加载通过。修复：`cws-screenshots.js` CHROME_MOCK 补 `chrome.tabs.get`、`chrome.runtime.onMessage/sendMessage`、`mioOnboardingDone: true`（否则新代码 init 抛错致 suggest 面板不渲染）。

## 已知坑

- `git push` 需绕过直连失败与凭据弹窗。当前可用：系统代理 `127.0.0.1:48521`；命令：`$env:GIT_TERMINAL_PROMPT="0"; git -c credential.helper= -c http.proxy="http://127.0.0.1:48521" -c https.proxy="http://127.0.0.1:48521" push <URL-x-access-token> main`。remote URL 已内嵌 GitHub token（`ghp_...@github.com`），但 GCM（manager-core）会拦截弹窗，必须 `-c credential.helper=` 禁用。已实测 2026-08-15 推送 10 个 commit 成功。直连 github.com:443 超时不可用。
- 浏览器全局 script 加载会共享 const：跨文件顶层常量需唯一命名（SESSION_KEY 冲突已修）。
- headless Chrome 截图：CDP `--load-extension` 在 temp profile 下不注入 MV3 content scripts。
- 记忆服务（hermes-memory MCP）当前返回损坏 JSON，不可用。
- `cws-screenshots.js` 的 CHROME_MOCK 需跟上 sidepanel 用到的 chrome.* API：新增 `chrome.tabs.get`、`chrome.runtime.onMessage` 等时同步补 mock，且设 `mioOnboardingDone: true` 防引导遮罩挡住截图。
