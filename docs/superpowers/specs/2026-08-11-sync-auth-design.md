# 云同步（账户登录）设计文档

日期：2026-08-11
状态：已批准
版本目标：v0.1.44
取代：2026-08-11-sync-cloud-design.md（API Key 自托管方案）

## 目标

将云同步从「API Key 自托管」重构为「官方账户登录」：默认免登录使用核心功能，注册/登录后自动启用云同步，多设备无缝同步执行历史。

## 核心决策

- **服务端托管加密**：后端启动时加载 SYNC_KEK，records 读写经 AES-GCM 加解密；客户端不再自行派生加密密钥
- **服务端不可读用户密码**：密码 hash（scrypt）存库，仅用于登录验证；KEK 由环境变量注入，独立于账户体系
- **长期会话**：登录发随机 token（hex 64 字节），存服务端 token 表 + 客户端 chrome.storage.local；登出吊销
- **忘记密码可重置**：服务端托管 KEK，重置密码后可解密旧数据重新加密（新密码 hash 存库）
- **注册即用**：无需邮件验证
- **API Key 自托管模式移除**：设置面板替换为登录/登出 UI

## 架构

```
扩展 (browser-agent)                        mio-auth-server (自托管)
  +---------------------------+   HTTPS    +--------------------------+
  | 设置面板: 注册/登录/登出  | --------> | POST /v1/auth/register   |
  | auth-client.js            |           | POST /v1/auth/login      |
  | sync-client.js (改造)     |           | POST /v1/auth/logout     |
  |  Bearer <token> 鉴权      |           | GET  /v1/records (隔离)  |
  |  复用 sanitizeRecord      |           | PUT  /v1/records/:id     |
  +---------------------------+           | KEK env 读写加密         |
                                          +--------------------------+
```

## 后端扩展（server/）

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /v1/auth/register | {email, password} -> {token, email} |
| POST | /v1/auth/login | {email, password} -> {token, email} |
| POST | /v1/auth/logout | Bearer token，吊销 |
| GET | /v1/auth/me | Bearer -> {email} |
| GET | /v1/records | Bearer -> 当前用户 bundles |
| PUT | /v1/records/:id | Bearer + body -> 保存 |
| DELETE | /v1/records/:id | Bearer -> 删除 |

### 数据模型（store.js 三张表）

- users: {email, passwordHash, salt, createdAt, updatedAt}
- tokens: {token, email, createdAt}（长期，登出删除）
- records: {id: {email, updatedAt, ciphertext, iv}}（KEK 加密存储，按 email 隔离查询）

### 安全实现

- 密码 hash：crypto.scryptSync(password, salt, 64).toString("hex")，salt = crypto.randomBytes(16)
- token：crypto.randomBytes(32).toString("hex")，hex 64 字节
- KEK 加密：SYNC_KEK env（hex 64 字节 = AES-256），records 存 {ciphertext, iv}，读时解密返回明文

### 新增 server/crypto.js

- loadKek()：读 SYNC_KEK env，hex -> Buffer(32)；缺失则启动失败
- encrypt(plaintext)：AES-256-GCM，返回 {ciphertext, iv}
- decrypt(ciphertext, iv)：验证 + 解密

## 客户端改造

### 新增 common/auth-client.js

CommonJS + globalThis 双导出：

| 函数 | 说明 |
|------|------|
| register(email, password, serverUrl) | POST register -> 存 session |
| login(email, password, serverUrl) | POST login -> 存 session |
| logout(serverUrl) | POST logout + 清本地 |
| isLoggedIn() | 本地 session 有效 |
| getSession() | 返回 {token, email} |
| clearSession() | 清本地 |

### common/sync-client.js 改造

- syncHistory(serverUrl, token, localList) — 签名从 (serverUrl, apiKey, localList) 改为 (serverUrl, token, localList)
- _req 鉴权 header 从 X-Api-Key 改为 Authorization: Bearer <token>
- 加密/合并/sanitizeRecord 不动

### common/storage.js

- sync 配置字段改为 {enabled, serverUrl}（移除 apiKey）
- 新增 session: {token, email} 独立存储键

### 设置面板

- 未登录：邮箱/密码/服务器地址 + 注册/登录按钮
- 已登录：账户邮箱 + 登出 + 手动同步 + 状态区
- 移除：API Key 输入、测试连接

## 错误处理

- 401 token 过期 -> 清本地 session + 提示重新登录
- 409 注册邮箱已存在 -> 提示「该邮箱已注册，请直接登录」
- 网络错误 -> 温和提示，不打断主流程
- 服务端 KEK 缺失 -> 启动失败并打印明确错误

## 测试

- tests/test_auth.js（新）：register/login/logout 往返（mock http）、token 校验、密码错误 401、session 存取
- tests/test_server.js 扩展：auth 端点 + Bearer token 鉴权 + KEK 读写加密往返 + records 用户隔离
- tests/test_sync.js 改造：syncHistory 签名适配（token 替代 apiKey）
- tests/test_agent.js：settings 归一化（sync 无 apiKey + session 新增）

## 回归文档

docs/test-prompts.md 场景十改为「云同步（账户登录）」，3 个任务：注册登录、多设备同步、登出/换设备。

## 交付物

- 后端零运行时依赖（仍只用 node 内置 crypto/http/fs/path）
- 部署文档更新：新增 SYNC_KEK env 说明（首次启动自动生成并提示持久化）
- Dockerfile 不变；README 加账户体系说明
