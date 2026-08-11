# mio-sync-server 部署指南

## 目录结构

```
server/
├── index.js          # HTTP 服务器入口
├── store.js          # 数据存储（users/tokens/records 三表）
├── auth.js           # 密码 hash + token 验证
├── crypto.js         # KEK 加密（AES-256-GCM）
├── package.json      # 零依赖
├── .env.example      # 环境变量模板
└── Dockerfile        # Docker 部署
```

## 环境变量

| 变量 | 说明 | 必填 | 默认值 |
|------|------|------|--------|
| `SYNC_KEK` | 32 字节 hex（AES-256 密钥），用于记录加密 | 是 | - |
| `PORT` | 监听端口 | 否 | 8181 |
| `DATA_DIR` | 数据目录 | 否 | `data` |

## 本地运行

```bash
cd server

# 生成 KEK（32 字节 = 64 hex 字符）
export SYNC_KEK=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# 启动
node index.js
```

输出：
```
mio-auth-server on :8181
```

## Docker 部署

```bash
# 构建镜像
docker build -t mio-sync-server .

# 运行
docker run -d \
  -p 8181:8181 \
  -e SYNC_KEK=<your-64-hex-chars> \
  -v $PWD/data:/app/data \
  --name mio-sync-server \
  mio-sync-server
```

## Nginx 反代 + HTTPS（生产环境推荐）

```nginx
server {
    listen 443 ssl;
    server_name sync.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8181;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 验证部署

```bash
# 健康检查
curl https://sync.yourdomain.com/v1/health
# {"ok":true}

# 注册测试
curl -X POST https://sync.yourdomain.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# 登录测试
curl -X POST https://sync.yourdomain.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## 扩展端配置

扩展默认连接 `https://mio-sync.example.com`。部署后修改 `sidepanel.js` 的常量：

```js
const SYNC_SERVER = "https://your-actual-domain.com";
```

重新打包扩展即可。

## 数据存储

- `data/store.json`：包含 users、tokens、records 三张表
- 记录在写入时经 KEK AES-256-GCM 加密，读取时解密
- 用户数据按 email 隔离

## 注意事项

1. `SYNC_KEK` **必须保密**，泄露会导致所有历史记录可被解密
2. 首次启动若缺少 `SYNC_KEK` 会报错退出
3. 生产环境建议配置 Nginx 限流、日志、监控
4. 定期备份 `data/store.json`