# Docker NapCat 部署指南

## 推荐方式：一键 Docker 部署

使用自包含的 Docker 镜像，将 NapCat + QCE 插件 + 前端打包为一体化容器，支持全平台（包括 macOS/Apple Silicon）。

### 前提条件

- Docker Desktop（macOS/Windows）或 Docker Engine（Linux）
- 约 2GB 磁盘空间

### 快速启动

```bash
git clone https://github.com/shuakami/qq-chat-exporter.git
cd qq-chat-exporter/docker
docker compose up -d
```

### 查看登录二维码

```bash
docker logs -f napcat-qce
```

扫码登录后按 Ctrl+C 退出日志查看。

### 获取 Token

```bash
docker logs napcat-qce 2>&1 | grep -i token
```

### 访问前端

打开浏览器访问：`http://localhost:40653/qce-v4-tool`

### 使用预构建镜像（发布后可用）

如果不想本地构建，可以直接使用预构建镜像。编辑 `docker/docker-compose.yml`，取消注释 `image` 行并注释 `build` 部分：

```yaml
services:
  napcat-qce:
    image: ghcr.io/shuakami/napcat-qce:latest
    # build:
    #   context: ..
    #   dockerfile: docker/Dockerfile
```

### 数据持久化

| 卷名 | 容器路径 | 说明 |
|------|---------|------|
| qq-session | /app/.config/QQ | QQ 登录会话 |
| qce-data | /root/.qq-chat-exporter | 导出数据 |
| ./config | /app/napcat/config | NapCat 配置 |

### macOS/Apple Silicon 说明

Docker Compose 配置中 `platform: linux/amd64` 确保在 Apple Silicon 上通过 Rosetta 2 模拟运行 x86_64 容器。首次启动可能需要 1-2 分钟。

---

## 进阶方式：手动挂载到现有 NapCat Docker

如果你已经有运行中的 NapCat Docker 容器，可以将 QCE 作为插件手动挂载。

### 前提条件

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
│   └── napcat-plugin-qce/      ← QCE 插件
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
cp -r /tmp/qce-release/plugins/napcat-plugin-qce plugins/

# 复制前端静态文件
cp -r /tmp/qce-release/static/qce-v4-tool ./qce-v4-tool
```

### 3. ARM64 架构适配

如果 Docker 运行在 ARM64（如 Apple Silicon / 树莓派 / 部分云服务器），Release 包中的 esbuild 二进制仅含 x64 版本，需要安装对应架构的包：

```bash
# 方法一：使用辅助脚本（推荐）
docker exec napcat bash /app/napcat/plugins/napcat-plugin-qce/tools/docker-setup.sh

# 方法二：手动安装
# 1. 查看当前 esbuild 版本
docker exec napcat node -e "console.log(require('/app/napcat/plugins/napcat-plugin-qce/node_modules/esbuild/package.json').version)"
# 2. 在宿主机下载对应版本的 ARM64 包
npm pack @esbuild/linux-arm64@<版本号>
# 3. 解压到插件目录
mkdir -p plugins/napcat-plugin-qce/node_modules/@esbuild/linux-arm64
tar -xzf esbuild-linux-arm64-*.tgz -C plugins/napcat-plugin-qce/node_modules/@esbuild/linux-arm64 --strip-components=1
```

### 4. 启用插件

NapCat 默认仅启用内置插件，需创建 `config/plugins.json`：

```json
{
  "napcat-plugin-builtin": true,
  "napcat-plugin-qce": true
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
[Plugins] 加载插件: napcat-plugin-qce
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
检查 `config/plugins.json` 是否存在且 `"napcat-plugin-qce": true`。

### 前端 404
检查 `qce-v4-tool/` 目录是否包含 `index.html` 和 `_next/` 目录，且已正确挂载到 `/app/napcat/static/qce-v4-tool`。

### 导出的文件在哪里
导出文件保存在容器内的 `~/.qq-chat-exporter/exports/`，可通过 Web UI 下载。
