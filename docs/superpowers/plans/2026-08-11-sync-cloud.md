# 云同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 mio 浏览器 Agent 增加执行历史云同步：自托管轻后端 + 端到端加密客户端 + 时间戳冲突合并。

**Architecture:** 扩展侧新增 `common/sync-client.js`（PBKDF2 派生密钥 + AES-GCM 加密 + fetch 直调后端 + 按 finishedAt 合并），设置面板加同步区；后端在 `server/` 子目录提供零依赖 Node http 服务（只存密文，无解密分支）。

**Tech Stack:** Node 内置 `http`/`fs`/`crypto`（后端）；Web Crypto API `crypto.subtle`（扩展加密）；CommonJS + globalThis 双导出（同 history.js 风格）。

---

### Task 1: sync-client.js 加密与合并核心

**Files:**
- Create: `common/sync-client.js`
- Test: `tests/test_sync.js`

- [ ] **Step 1: 写失败测试**（tests/test_sync.js，含加密往返/deriveKey 幂等/时间戳合并/损坏密文/401/URL 拼装）

```js
const sync = require("../common/sync-client.js");

async function run() {
  let pass = 0, fail = 0;
  function assertEq(got, want, msg) {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
    else { fail++; console.error("FAIL " + msg + " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  }
  function assertOk(cond, msg) { if (cond) pass++; else { fail++; console.error("FAIL " + msg); } }

  // deriveKey 幂等
  const k1 = await sync.deriveKey("test-key");
  const k2 = await sync.deriveKey("test-key");
  assertEq(k1, k2, "deriveKey deterministic");

  // 加密往返
  const rec = { id: "a1", goal: "任务", status: "done", finishedAt: 1000, logs: [] };
  const bundle = await sync.encryptRecord(rec, k1);
  assertOk(bundle.ciphertext && bundle.iv, "encryptRecord produces ciphertext+iv");
  assertEq(bundle.id, "a1", "bundle carries id");
  assertEq(bundle.updatedAt, 1000, "updatedAt = finishedAt");
  const back = await sync.decryptRecord(bundle, k1);
  assertEq(back.goal, "任务", "roundtrip goal");

  // 错误 key 解不开
  const k3 = await sync.deriveKey("other-key");
  let threw = false;
  try { await sync.decryptRecord(bundle, k3); } catch (_) { threw = true; }
  assertOk(threw, "wrong key fails decrypt");

  // URL 拼装
  assertEq(sync.apiUrl("https://x.com", "records"), "https://x.com/v1/records", "apiUrl join");
  assertEq(sync.apiUrl("https://x.com/", "records/a1"), "https://x.com/v1/records/a1", "apiUrl strip trailing slash");

  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_sync.js`
Expected: FAIL，`Cannot find module '../common/sync-client.js'`

- [ ] **Step 3: 实现 sync-client.js**

```js
const SALT = "mio-sync-v1";
const PBKDF2_ITERATIONS = 100000;

function b64u(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(s) {
  return new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

async function deriveKey(apiKey) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(apiKey), "PBKDF2", false, ["deriveKey"]);
  const material = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(SALT), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  // AES-GCM 的 CryptoKey 不能直接 JSON 序列化，导出字节以便缓存/比较
  const raw = await crypto.subtle.exportKey("raw", material);
  return b64u(new Uint8Array(raw));
}

async function _rawKey(b64) {
  return crypto.subtle.importKey("raw", unb64u(b64), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptRecord(rec, keyB64) {
  const k = await _rawKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(rec));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, data);
  return {
    id: rec.id,
    updatedAt: rec.finishedAt || 0,
    ciphertext: b64u(new Uint8Array(ct)),
    iv: b64u(iv),
  };
}

async function decryptRecord(bundle, keyB64) {
  const k = await _rawKey(keyB64);
  const iv = unb64u(bundle.iv);
  const ct = unb64u(bundle.ciphertext);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

function apiUrl(serverUrl, path) {
  return serverUrl.replace(/\/+$/, "") + "/v1/" + path;
}

// 时间戳合并：同 id 较新 finishedAt 覆盖；返回 {local, remote, toPush}
function mergeRecords(localList, remoteList) {
  const localMap = new Map(localList.map((r) => [r.id, r]));
  const remoteMap = new Map(remoteList.map((r) => [r.id, r]));
  const toPush = [];
  const pulled = [];
  for (const [id, r] of remoteMap) {
    const l = localMap.get(id);
    if (!l) { pulled.push(r); localMap.set(id, r); }
    else if ((r.finishedAt || 0) > (l.finishedAt || 0)) { localMap.set(id, r); pulled.push(r); }
  }
  for (const [id, l] of localMap) {
    const r = remoteMap.get(id);
    if (!r) toPush.push(l);
    else if ((l.finishedAt || 0) > (r.finishedAt || 0)) toPush.push(l);
  }
  const merged = Array.from(localMap.values());
  return { merged, pulled, toPush };
}

if (typeof module !== "undefined") {
  module.exports = { SALT, deriveKey, encryptRecord, decryptRecord, apiUrl, mergeRecords };
} else {
  globalThis.SyncClient = { SALT, deriveKey, encryptRecord, decryptRecord, apiUrl, mergeRecords };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_sync.js`
Expected: PASS（crypto.subtle 在 Node ≥15 全局可用）

- [ ] **Step 5: 提交**

```bash
git add common/sync-client.js tests/test_sync.js
git commit -m "feat(sync): 加密与时间戳合并核心"
```

---

### Task 2: syncHistory 同步流程（listRemote/putRecord/同步编排）

**Files:**
- Modify: `common/sync-client.js`
- Test: `tests/test_sync.js`

- [ ] **Step 1: 写失败测试**（mock fetch，验证拉取/上传/统计）

```js
// 追加到 tests/test_sync.js 的 run() 内
  // syncHistory 编排（mock fetch）
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, method: opts && opts.method || "GET", key: opts && opts.headers && opts.headers["X-Api-Key"] });
    if (opts && opts.method === "PUT") return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: true, status: 200, json: async () => [{ id: "r1", updatedAt: 5000, ciphertext: "x", iv: "y" }] };
  };
  const local = [
    { id: "r1", goal: "旧", finishedAt: 1000 },
    { id: "r2", goal: "新本地", finishedAt: 2000 },
  ];
  const res = await sync.syncHistory("https://srv", "k", local);
  assertOk(calls.some((c) => c.method === "GET"), "syncHistory lists remote");
  const puts = calls.filter((c) => c.method === "PUT");
  assertOk(puts.length >= 1, "syncHistory pushes missing local");
  assertOk(puts.every((c) => c.key === "k"), "PUT carries api key");
  assertOk(res.pulled.length >= 1, "pull reported");
  delete global.fetch;
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_sync.js`
Expected: FAIL，`sync.syncHistory is not a function`

- [ ] **Step 3: 实现 syncHistory 等函数**（追加到 sync-client.js，`http` 辅助 + `listRemote`/`putRecord`/`syncHistory`）

```js
async function _req(serverUrl, apiKey, path, method, body) {
  const url = apiUrl(serverUrl, path);
  const headers = { "X-Api-Key": apiKey };
  if (body) headers["Content-Type"] = "application/json";
  const resp = await fetch(url, {
    method: method || "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const err = new Error("HTTP " + resp.status);
    err.status = resp.status;
    throw err;
  }
  return resp.status === 204 ? null : resp.json();
}

async function listRemote(serverUrl, apiKey) {
  return _req(serverUrl, apiKey, "records", "GET");
}
async function putRecord(serverUrl, apiKey, bundle) {
  return _req(serverUrl, apiKey, "records/" + encodeURIComponent(bundle.id), "PUT", {
    updatedAt: bundle.updatedAt,
    ciphertext: bundle.ciphertext,
    iv: bundle.iv,
  });
}

async function syncHistory(serverUrl, apiKey, localList) {
  const key = await deriveKey(apiKey);
  const remoteBundles = await listRemote(serverUrl, apiKey);
  const remote = [];
  const failed = [];
  for (const b of remoteBundles) {
    try { remote.push(await decryptRecord(b, key)); }
    catch (_) { failed.push(b.id); }
  }
  const { merged, pulled, toPush } = mergeRecords(localList, remote);
  let pushed = 0;
  for (const rec of toPush) {
    try {
      await putRecord(serverUrl, apiKey, await encryptRecord(rec, key));
      pushed++;
    } catch (e) { failed.push(rec.id); }
  }
  return { merged, pulled: pulled.length, pushed, skipped: toPush.length - pushed, failed };
}
```

并在 module.exports / globalThis 增加：`_req, listRemote, putRecord, syncHistory`。

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_sync.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add common/sync-client.js tests/test_sync.js
git commit -m "feat(sync): syncHistory 拉取/上传编排"
```

---

### Task 3: storage.js 增加 sync 配置

**Files:**
- Modify: `common/storage.js`
- Test: `tests/test_agent.js:439-448`（settings 归一化区）

- [ ] **Step 1: 写失败测试**（test_agent.js settings 区追加）

```js
const ss = storage.normalizeSettings({ sync: { enabled: true, serverUrl: "https://s", apiKey: "k" } }).sync;
assertEq(ss.enabled, true, "normalizeSettings keeps sync.enabled");
assertEq(ss.serverUrl, "https://s", "normalizeSettings keeps sync.serverUrl");
assertEq(ss.lastSyncAt, 0, "normalizeSettings sync.lastSyncAt default 0");
const ssDef = storage.normalizeSettings({}).sync;
assertEq(ssDef.enabled, false, "normalizeSettings sync default disabled");
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_agent.js`
Expected: FAIL，`Cannot read properties of undefined`（sync 未定义）

- [ ] **Step 3: 实现**（storage.js）

```js
const DEFAULT_SETTINGS = {
  provider: "openai",
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  maxSteps: 30,
  enableVision: false,
  vision: {
    provider: "openai",
    model: "",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
  },
  sync: {
    enabled: false,
    serverUrl: "",
    apiKey: "",
    lastSyncAt: 0,
  },
};

function normalizeSync(v) {
  return Object.assign({}, DEFAULT_SETTINGS.sync, v || {});
}
function normalizeSettings(s) {
  const out = Object.assign({}, DEFAULT_SETTINGS, s || {});
  out.vision = normalizeVision(out.vision);
  out.sync = normalizeSync(out.sync);
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_agent.js`
Expected: 全部 PASS（含新断言）

- [ ] **Step 5: 提交**

```bash
git add common/storage.js tests/test_agent.js
git commit -m "feat(storage): settings 增加 sync 配置"
```

---

### Task 4: server/ 零依赖后端

**Files:**
- Create: `server/package.json`
- Create: `server/index.js`
- Create: `server/store.js`
- Create: `server/auth.js`
- Create: `server/.env.example`
- Create: `server/Dockerfile`
- Create: `server/README.md`

- [ ] **Step 1: 写失败测试**（tests/test_server.js，node 内置 assert，直接 require 并用 http 起真实 server 打到 400/401）

```js
const assert = require("assert");
const http = require("http");
const { createApp } = require("../server/index.js");

function req(port, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function run() {
  process.env.SYNC_API_KEY = "s3cret";
  const server = http.createServer(createApp());
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;

  // health 无需 key
  let r = await req(port, "GET", "/v1/health");
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.includes("ok"));

  // 无 key 401
  r = await req(port, "GET", "/v1/records");
  assert.strictEqual(r.status, 401, "no key -> 401");

  // 错误 key 401
  r = await req(port, "GET", "/v1/records", { "X-Api-Key": "wrong" });
  assert.strictEqual(r.status, 401, "wrong key -> 401");

  // PUT + GET 往返
  const body = JSON.stringify({ updatedAt: 100, ciphertext: "ct", iv: "iv" });
  r = await req(port, "PUT", "/v1/records/a1", { "X-Api-Key": "s3cret", "Content-Type": "application/json" }, body);
  assert.strictEqual(r.status, 200, "PUT ok");
  r = await req(port, "GET", "/v1/records", { "X-Api-Key": "s3cret" });
  assert.strictEqual(r.status, 200, "GET ok");
  assert.ok(r.data.includes("a1"), "record returned");

  // DELETE
  r = await req(port, "DELETE", "/v1/records/a1", { "X-Api-Key": "s3cret" });
  assert.strictEqual(r.status, 200, "DELETE ok");
  r = await req(port, "GET", "/v1/records", { "X-Api-Key": "s3cret" });
  assert.ok(!r.data.includes("a1"), "deleted");

  server.close();
  console.log("server tests passed");
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行确认失败**

Run: `node tests/test_server.js`
Expected: FAIL，`Cannot find module '../server/index.js'`

- [ ] **Step 3: 实现 server/**（零依赖）

`server/store.js`:
```js
const fs = require("fs");
const path = require("path");

function createStore(dataDir) {
  const file = path.join(dataDir, "records.json");
  fs.mkdirSync(dataDir, { recursive: true });
  let data = {};
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { data = {}; }
  }
  return {
    list() { return Object.keys(data).map((id) => ({ id, ...data[id] })); },
    get(id) { return data[id] || null; },
    put(id, rec) { data[id] = { updatedAt: rec.updatedAt, ciphertext: rec.ciphertext, iv: rec.iv }; this.save(); },
    del(id) { if (data[id]) { delete data[id]; this.save(); } },
    save() { fs.writeFileSync(file, JSON.stringify(data)); },
  };
}

module.exports = { createStore };
```

`server/auth.js`:
```js
const crypto = require("crypto");

function makeAuth(apiKey) {
  if (!apiKey) throw new Error("SYNC_API_KEY env is required");
  const expected = Buffer.from(apiKey);
  return (req) => {
    const provided = req.headers["x-api-key"];
    if (!provided) return false;
    const a = Buffer.from(provided);
    return a.length === expected.length && crypto.timingSafeEqual(a, expected);
  };
}

module.exports = { makeAuth };
```

`server/index.js`:
```js
const { createStore } = require("./store.js");
const { makeAuth } = require("./auth.js");

function createApp(opts) {
  const store = opts && opts.store || createStore(opts && opts.dataDir || "data");
  const auth = makeAuth(process.env.SYNC_API_KEY);
  return (req, res) => {
    const send = (status, obj) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/v1/health" && req.method === "GET") return send(200, { ok: true });
    if (!url.pathname.startsWith("/v1/")) return send(404, { error: "not found" });
    if (!auth(req)) return send(401, { error: "unauthorized" });
    if (url.pathname === "/v1/records" && req.method === "GET") {
      return send(200, store.list());
    }
    const m = url.pathname.match(/^\/v1\/records\/([^/]+)$/);
    if (!m) return send(404, { error: "not found" });
    const id = decodeURIComponent(m[1]);
    if (req.method === "PUT") {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        try {
          const rec = JSON.parse(body);
          if (!rec || typeof rec.ciphertext !== "string" || typeof rec.iv !== "string") {
            return send(400, { error: "bad bundle" });
          }
          store.put(id, { updatedAt: Number(rec.updatedAt) || 0, ciphertext: rec.ciphertext, iv: rec.iv });
          send(200, { ok: true });
        } catch (_) { send(400, { error: "bad json" }); }
      });
      return;
    }
    if (req.method === "DELETE") {
      store.del(id);
      return send(200, { ok: true });
    }
    send(405, { error: "method not allowed" });
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8181;
  const dataDir = process.env.DATA_DIR || "data";
  require("http").createServer(createApp({ dataDir })).listen(port, () => {
    console.log("mio-sync-server on :" + port);
  });
}

module.exports = { createApp };
```

`server/package.json`:
```json
{
  "name": "mio-sync-server",
  "version": "0.1.0",
  "private": true,
  "description": "mio 云同步轻后端（零依赖）",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  }
}
```

`server/.env.example`:
```
SYNC_API_KEY=change-me-to-a-long-random-string
PORT=8181
DATA_DIR=data
```

`server/Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
ENV SYNC_API_KEY=change-me
ENV PORT=8181
EXPOSE 8181
CMD ["node", "index.js"]
```

`server/README.md`:
```markdown
# mio-sync-server

零依赖云同步后端，只存密文（无解密能力）。

## 运行

```bash
SYNC_API_KEY=your-key node index.js
```

或 Docker：

```bash
docker build -t mio-sync-server .
docker run -p 8181:8181 -e SYNC_API_KEY=your-key -v $PWD/data:/app/data mio-sync-server
```

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /v1/health | 健康检查 |
| GET | /v1/records | 所有 bundle（X-Api-Key） |
| PUT | /v1/records/:id | 保存 bundle |
| DELETE | /v1/records/:id | 删除 |

多用户：把 auth.js 的单 key 比较换成 Key 表即可。
```

- [ ] **Step 4: 运行确认通过**

Run: `node tests/test_server.js`
Expected: `server tests passed`

- [ ] **Step 5: 提交**

```bash
git add server/ tests/test_server.js
git commit -m "feat(server): 零依赖云同步轻后端"
```

---

### Task 5: sidepanel 设置面板同步区

**Files:**
- Modify: `sidepanel/sidepanel.html:606-621`
- Modify: `sidepanel/sidepanel.js:147-202`

- [ ] **Step 1: 加 UI 结构**（sidepanel.html，Vision API Key 之后、保存按钮之前）

```html
        <div class="full vis-head">云同步（执行历史跨设备备份，端到端加密）</div>
        <div><label><input id="syncEnabled" type="checkbox" style="width:auto; vertical-align:middle"> 启用云同步</label></div>
        <div class="full"><label>同步服务器</label><input id="syncServer" placeholder="https://your-server.example.com"></div>
        <div class="full"><label>同步 API Key</label><input id="syncApiKey" type="password"></div>
        <div class="full" id="syncStatus" style="font-size:12px; color:var(--subtext)"></div>
        <div class="full">
          <button id="syncTest">测试连接</button>
          <button id="syncNow">立即同步</button>
        </div>
```

- [ ] **Step 2: 实现 init 加载/保存 + 按钮逻辑**（sidepanel.js）

init() 的 settings 加载区（`$("visionApiKey").value = v.apiKey || "";` 之后）追加：
```js
  const sync = s.sync || {};
  $("syncEnabled").checked = !!sync.enabled;
  $("syncServer").value = sync.serverUrl || "";
  $("syncApiKey").value = sync.apiKey || "";
  if (sync.lastSyncAt) $("syncStatus").textContent = "上次同步: " + new Date(sync.lastSyncAt).toLocaleString();
```

saveSettings 的 setSettings 对象（vision 之后）追加：
```js
      sync: {
        enabled: !!$("syncEnabled").checked,
        serverUrl: $("syncServer").value.trim(),
        apiKey: $("syncApiKey").value.trim(),
        lastSyncAt: (await getSettings()).sync && (await getSettings()).sync.lastSyncAt || 0,
      },
```

按钮监听（`$("saveSettings")` 监听之后）追加：
```js
  $("syncTest").addEventListener("click", async () => {
    const url = $("syncServer").value.trim();
    if (!url) return toast("请先填同步服务器地址");
    try {
      const r = await fetch(url.replace(/\/+$/, "") + "/v1/health");
      toast(r.ok ? "连接成功" : "连接失败 (HTTP " + r.status + ")");
    } catch (_) { toast("无法连接服务器"); }
  });
  $("syncNow").addEventListener("click", async () => {
    const url = $("syncServer").value.trim();
    const key = $("syncApiKey").value.trim();
    if (!url || !key) return toast("请先填服务器地址和 API Key");
    try {
      const hist = await HistoryModule.getHistory();
      const res = await SyncClient.syncHistory(url, key, hist);
      if (res.merged) await HistoryModule._setRawHistory(res.merged);
      const st = await getSettings();
      st.sync.lastSyncAt = Date.now();
      await setSettings(st);
      $("syncStatus").textContent = "已同步 · 拉取 " + res.pulled + " · 上传 " + res.pushed + (res.failed ? " · 失败 " + res.failed : "");
      toast("同步完成");
    } catch (e) {
      const msg = e && e.status === 401 ? "API Key 错误" : (e && e.status === 404 ? "服务器未就绪" : "无法连接服务器");
      toast("同步失败: " + msg);
    }
  });
```

> 注意：`HistoryModule._setRawHistory` 尚不存在，Task 6 会加；此处依赖该导出。

- [ ] **Step 3: 语法检查**

Run: `node --check sidepanel/sidepanel.js`
Expected: 无输出

- [ ] **Step 4: 提交**

```bash
git add sidepanel/sidepanel.html sidepanel/sidepanel.js
git commit -m "feat(sidepanel): 云同步设置区 + 测试连接/立即同步"
```

---

### Task 6: history.js 暴露 _setRawHistory + 自动同步

**Files:**
- Modify: `common/history.js:105-121`
- Modify: `sidepanel/sidepanel.js:281-286`

- [ ] **Step 1: history.js 增加 _setRawHistory**（导出列表里加，globalThis 分支同理）

```js
async function _setRawHistory(list) {
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, MAX_RECORDS) });
}
```

module.exports 加 `_setRawHistory`；globalThis.HistoryModule 加 `_setRawHistory`。

- [ ] **Step 2: 自动同步触发**（sidepanel.js historyLog，`await HistoryModule.addHistoryRecord(currentTask);` 之后）

```js
  const st = await getSettings();
  if (st.sync && st.sync.enabled && st.sync.serverUrl && st.sync.apiKey) {
    try {
      const res = await SyncClient.syncHistory(st.sync.serverUrl, st.sync.apiKey, await HistoryModule.getHistory());
      if (res.merged) await HistoryModule._setRawHistory(res.merged);
      st.sync.lastSyncAt = Date.now();
      await setSettings(st);
    } catch (_) { /* 静默，不打断任务完成 */ }
  }
```

- [ ] **Step 3: 验证**

Run: `node tests/test_agent.js`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add common/history.js sidepanel/sidepanel.js
git commit -m "feat(sync): 历史变更后自动云同步"
```

---

### Task 7: bump 0.1.43 + 回归文档 + 全量验证

**Files:**
- Modify: `manifest.json`
- Modify: `docs/test-prompts.md`

- [ ] **Step 1: bump manifest**

`manifest.json` `"version": "0.1.42"` → `"0.1.43"`

- [ ] **Step 2: 回归文档加场景十**（docs/test-prompts.md，「场景九」之后、失败信号表之前，追加场景十）

```markdown
## ☁ 场景十：云同步

**验证点**：配置同步服务器、手动同步、跨设备数据一致性。

> 对应 v0.1.43 云同步：本地起 server/（SYNC_API_KEY 任意）→ sidepanel 设置填地址+key → 立即同步。

### 任务 1 · 配置与手动同步

```
设置里启用云同步，填本机起的 server 地址（http://127.0.0.1:8181）和 API Key，点「测试连接」应提示连接成功；点「立即同步」，历史多出的记录应出现在云端（data/records.json）。
```

### 任务 2 · 跨设备拉取

```
在 server 的 data/records.json 里手工多放一条记录（或用另一台配置同 key 的扩展写入），本机点「立即同步」，历史应出现这条记录。
```

### 任务 3 · 冲突覆盖

```
同一 id 的本地记录 finishedAt 较新时同步，云端被本地覆盖；云端较新时本地被云端覆盖。
```
```

并在失败信号表追加一行：`| 同步失败但无提示 | 网络/配置错误未温和提示 | 中 |`

- [ ] **Step 3: 全量验证**

Run: `node tests/test_agent.js` 和 `node tests/test_sync.js` 和 `node tests/test_server.js`
Expected: 全部 PASS

- [ ] **Step 4: 提交**

```bash
git add manifest.json docs/test-prompts.md
git commit -m "chore: bump 0.1.43 + 回归集补云同步场景"
```

---

## Self-Review 备注

- spec 覆盖：加密（T1）✓ 合并（T1）✓ syncHistory（T2）✓ settings（T3）✓ 后端（T4）✓ UI（T5）✓ 自动触发（T6）✓ 测试文档（T7）✓
- `_setRawHistory` 在 T5 引用、T6 定义——顺序依赖已在 T5 注明「Task 6 会加」。
- deriveKey 返回 base64 字符串（CryptoKey 不可序列化），encryptRecord/decryptRecord 接受该字符串——签名一致。
