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
