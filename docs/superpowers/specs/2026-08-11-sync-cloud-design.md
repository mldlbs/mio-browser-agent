# 云同步设计文档

日期：2026-08-11
状态：已批准
版本目标：v0.1.43

## 目标

为 mio 浏览器 Agent 增加「执行历史云同步」能力：历史记录跨设备可用，云端作为备份 + 跨设备载体，端到端加密，自托管轻后端。

## 范围

- **同步内容**：执行历史记录（goal/summary/status/tags/stepEvents/logs/recoveries/replans/startedAt/finishedAt），**不含** resume（防凭据/检查点泄露）。
- **不做**：任务库/模板同步、续跑点同步、账户体系、多用户多 Key 管理。

## 架构

```
扩展 (browser-agent)                       自托管 mio-sync-server
  ┌─────────────────────────┐   HTTPS    ┌────────────────────────┐
  │ 设置面板: 地址+Key+同步  │ ────────► │ GET/PUT /v1/records    │
  │ sync-client.js          │            │ 存: id→{updatedAt,     │
  │  E2E 加密 (Web Crypto)  │            │      ciphertext, iv}   │
  │  时间戳冲突合并          │            └────────────────────────┘
  └─────────────────────────┘
```

- 扩展侧新增 `common/sync-client.js`（纯逻辑、可单测）+ 设置面板同步区 + 自动触发。
- 后端新增 `server/` 子目录（与扩展同仓库版本配套），极简 Node http 服务，零运行时依赖。
- 不需要新 manifest 权限：`<all_urls>` 已涵盖任意服务器 fetch。

## 扩展侧组件

### common/sync-client.js

纯逻辑模块，CommonJS + globalThis 双导出（同 history.js 风格）。

| 函数 | 说明 |
|------|------|
| `deriveKey(apiKey)` | PBKDF2 (SHA-256, 固定 salt, 100k 迭代) → AES-GCM 256 密钥 |
| `encryptRecord(rec, key)` | 序列化 + AES-GCM 加密，返回 `{id, updatedAt, ciphertext, iv}`（updatedAt = rec.finishedAt） |
| `decryptRecord(bundle, key)` | 解密回 normalized record |
| `listRemote(serverUrl, apiKey)` | GET `/v1/records`（带 X-Api-Key） |
| `putRecord(serverUrl, apiKey, bundle)` | PUT `/v1/records/{id}` |
| `syncHistory(serverUrl, apiKey)` | 核心：拉清单→解密→按 finishedAt 与本地合并→上传缺失/较新→云端较新写本地→返回 `{pulled, pushed, skipped, failed}` |
| `needsSync(settings)` | 判断是否需自动同步（上次同步距今 >24h） |

### common/storage.js

settings 增加 `sync: { enabled, serverUrl, apiKey, lastSyncAt }`，`normalizeSettings` 归一化。apiKey 存本地 storage（与主模型 key 同级）。

### 设置面板同步区

- 开关「启用云同步」+ 服务器地址 + API Key 输入
- 「测试连接」按钮（GET /v1/health）
- 「立即同步」按钮 + 上次同步时间 + 最近结果状态

### 触发时机

1. 手动「立即同步」
2. 任务完成保存历史后自动同步（若 enabled）
3. 打开 sidepanel 且 >24h 未同步（仅拉取）

## 后端（server/ 子目录）

```
server/
  package.json     # 无依赖 (node:http)
  index.js         # http server + 路由 + JSON body 解析
  store.js         # 文件存储 data/records.json，启动自动创建
  auth.js          # API Key 校验 (env SYNC_API_KEY, timingSafeEqual)
  .env.example     # SYNC_API_KEY, PORT
  Dockerfile       # node:20-alpine
  README.md        # 部署说明
```

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v1/health` | 健康检查 `{ok:true}` |
| GET | `/v1/records` | 返回 bundle 数组 `[{id, updatedAt, ciphertext, iv}]` |
| PUT | `/v1/records/:id` | 保存/覆盖一条 bundle，body `{updatedAt, ciphertext, iv}` |
| DELETE | `/v1/records/:id` | 删除一条 |

鉴权：所有请求须带 `X-Api-Key`，`=== SYNC_API_KEY`（timingSafeEqual）。单 key 优先（自托管简单性），README 说明多 key 只需扩展 auth.js。

服务端只存密文，无解密分支。

### 威胁模型（如实声明）

加密密钥由 `PBKDF2(apiKey)` 派生，而同一 `apiKey` 以 `X-Api-Key` header 明文发给服务端做鉴权。因此**服务端运营者持有密钥派生材料，可解密所有记录**。本设计保证的是：

- 传输层外的人（抓包者、第三方）无法读内容；
- 服务端**代码**无解密分支（运营者除非主动推导，否则不接触明文）；
- 若服务器失陷或被运营者主动读取，则**不能**保证内容安全。

如需服务端不可读，需引入客户端独立口令（不同密钥）派生加密密钥，与鉴权 token 分离——列为后续增强（文档记录，非本次范围）。

### 已知限制

- `needsSync()`（>24h 自动拉取）未在本次实现；仅任务完成自动同步 + 手动按钮。
- 拉取合并后 `_setRawHistory` 仍按本地 50 条封顶裁剪，远端较旧记录可能在本地被立即裁剪（仍在云端）。
- 解密失败的远端记录被视为「远端缺失」，较旧的本地副本会重新覆盖上传（最后一次设备为准）。

数据格式：单文件 `data/records.json`（`{id: {updatedAt, ciphertext, iv}}`），README 注明可换 SQLite/Postgres。

## 错误处理

- HTTP 非 2xx：401→「API Key 错误」、404→「服务器未就绪」、网络错误→「无法连接服务器」，温和提示，不中断主流程
- 加密失败（Key 派生异常）→ 跳过该条并 `failed++`
- 同步失败不影响任务执行：后台任务，仅 `lastSyncAt` 不动 + 状态区显示错误
- 损坏 ciphertext：解密失败→跳过该条并 `failed++`，不回滚本地
- `finishedAt` 缺失视为 0（云端较新则拉取）

## 冲突策略

时间戳覆盖：同一 id，`finishedAt` 较新者赢；云端没有的本地记录直接上传；本地没有的云端记录直接拉取。

## 测试

- `tests/test_sync.js`（新）：加密解密往返、deriveKey 幂等、时间戳合并（本地新/云端新/新增/同 id）、损坏密文跳过、401、URL 拼装、settings 归一化 sync 字段
- `tests/test_agent.js`：settings 含 sync 的归一化断言
- 集成说明（可选）：本地起 server + 真 fetch 全链路，作手动回归场景
- `docs/test-prompts.md` 加「场景十：云同步」3 个任务

## 提交范围

- 新增：`common/sync-client.js`、`server/*`、`tests/test_sync.js`
- 修改：`common/storage.js`、`sidepanel/sidepanel.js`、`sidepanel/sidepanel.html`、`manifest.json`（bump 0.1.43）、`tests/test_agent.js`、`docs/test-prompts.md`
