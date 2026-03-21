# Docker NapCat 部署指南

在 Docker NapCat Shell 模式下部署 QQ Chat Exporter 插件。

## 前提条件

- 已部署 Docker NapCat（`mlikiowa/napcat-docker:latest`）
- NapCat 版本 >= 4.17（插件上下文使用 `oneBot` 属性）

## 目录结构

```
napcat/
├── docker-compose.yml
├── config/
│   ├── napcat_<QQ号>.json
│   └── plugins.json          ← 必须创建
├── plugins/
│   ├── napcat-plugin-builtin/ ← 从容器复制
│   └── qq-chat-exporter/      ← QCE 插件
└── qce-v4-tool/               ← 前端静态文件
```

## 部署步骤

### 1. 复制内置插件

挂载 `plugins/` 目录会覆盖容器内的内置插件，需先复制出来：

```bash
mkdir -p plugins
docker cp napcat:/app/napcat/plugins/napcat-plugin-builtin plugins/napcat-plugin-builtin
```

### 2. 安装 QCE 插件

从 [Releases](https://github.com/shuakami/qq-chat-exporter/releases) 下载 Shell 模式包，提取插件和前端：

```bash
# 解压 Release 包
tar -xzf NapCat-QCE-*.tar.gz -C /tmp/qce-release

# 复制插件
cp -r /tmp/qce-release/plugins/qq-chat-exporter plugins/

# 复制前端静态文件
cp -r /tmp/qce-release/static/qce-v4-tool ./qce-v4-tool
```

### 3. ARM64 架构适配

如果 Docker 运行在 ARM64（如 Apple Silicon / 树莓派 / 部分云服务器），Release 包中的 esbuild 二进制仅含 x64 版本，需要安装对应架构的包：

```bash
# 方法一：使用辅助脚本（推荐）
docker exec napcat bash /app/napcat/plugins/qq-chat-exporter/tools/docker-setup.sh

# 方法二：手动安装
# 1. 查看当前 esbuild 版本
docker exec napcat node -e "console.log(require('/app/napcat/plugins/qq-chat-exporter/node_modules/esbuild/package.json').version)"
# 2. 在宿主机下载对应版本的 ARM64 包
npm pack @esbuild/linux-arm64@<版本号>
# 3. 解压到插件目录
mkdir -p plugins/qq-chat-exporter/node_modules/@esbuild/linux-arm64
tar -xzf esbuild-linux-arm64-*.tgz -C plugins/qq-chat-exporter/node_modules/@esbuild/linux-arm64 --strip-components=1
```

### 4. 启用插件

NapCat 默认仅启用内置插件，需创建 `config/plugins.json`：

```json
{
  "napcat-plugin-builtin": true,
  "qq-chat-exporter": true
}
```

### 5. 修改 docker-compose.yml

```yaml
services:
  app:
    image: 'mlikiowa/napcat-docker:latest'
    container_name: napcat
    restart: unless-stopped
    volumes:
      - ./config:/app/napcat/config
      - /app/.config/QQ:/app/.config/QQ
      - ./plugins:/app/napcat/plugins
      - ./qce-v4-tool:/app/napcat/static/qce-v4-tool
    networks:
      - web-internal

networks:
  web-internal:
    external: true
```

关键挂载：
- `./plugins:/app/napcat/plugins` — 插件目录（含内置插件 + QCE）
- `./qce-v4-tool:/app/napcat/static/qce-v4-tool` — 前端静态文件

### 6. 启动并验证

```bash
docker compose up -d
docker logs -f napcat 2>&1 | grep -i "plugin\|qce\|chat-exporter"
```

预期日志：
```
[Plugins] 加载插件: napcat-plugin-builtin
[Plugins] 加载插件: qq-chat-exporter
[QCE] Running mode: Shell (headless)
[QCE] API server started on port 40653
```

### 7. 反向代理（可选）

QCE API 服务器监听 40653 端口。如需外部 HTTPS 访问，配置反向代理：

**Nginx Proxy Manager 配置：**
- 域名：`qce.example.com`
- 转发到：`napcat:40653`（同一 Docker 网络）
- 启用 WebSocket 支持（QCE 使用 WS 推送导出进度）
- SSL：使用你的证书

**Nginx 手动配置：**
```nginx
server {
    listen 443 ssl;
    server_name qce.example.com;

    location / {
        proxy_pass http://napcat:40653;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 访问

打开 `http://<服务器IP>:40653/qce-v4-tool` 或反向代理域名，使用控制台日志中的 Token 登录。

## 常见问题

### esbuild 报错 `Unsupported platform`
架构不匹配，参见步骤 3。

### 插件未加载（日志中无 QCE 相关输出）
检查 `config/plugins.json` 是否存在且 `"qq-chat-exporter": true`。

### 前端 404
检查 `qce-v4-tool/` 目录是否包含 `index.html` 和 `_next/` 目录，且已正确挂载到 `/app/napcat/static/qce-v4-tool`。

### 导出的文件在哪里
导出文件保存在容器内的 `~/.qq-chat-exporter/exports/`，可通过 Web UI 下载。
