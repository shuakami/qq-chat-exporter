# Docker NapCat 部署指南

如果你喜欢容器化部署，可以通过 Docker 来运行 QCE。本文档提供两种方案：**一体化快捷部署（推荐）** 以及 **手动挂载到现有 NapCat 容器（进阶）**。

## 一键 Docker 部署

这种方式使用自包含的 Docker 镜像，将 NapCat、QCE 插件以及前端网页全部打包进一个一体化的容器中，支持全平台运行（包括 Linux、Windows 以及搭载 Apple Silicon 芯片的 Mac）。

### 前提条件

* 电脑上已安装并运行 Docker Desktop（macOS / Windows）或 Docker Engine（Linux）。
* 拥有约 2GB 的可用磁盘空间。

---

### 快速启动步骤

1. 克隆项目仓库并进入 docker 目录：

```bash
git clone https://github.com/shuakami/qq-chat-exporter.git
cd qq-chat-exporter/docker
```

2. 启动容器：

```bash
docker compose up -d
```

3. 查看登录二维码：

```bash
docker logs -f napcat-qce
```

运行后，控制台会打印出登录二维码。用手机 QQ 扫描该二维码完成账号登录。登录成功后，按下键盘的 `Ctrl + C` 键即可退出日志查看。

---

### 获取网页访问令牌

打开操作网页需要安全令牌（Access Token），你可以通过以下两种方式获取：

#### 方式一：从容器日志中过滤

```bash
docker logs napcat-qce 2>&1 | grep -i token
```

#### 方式二：直接读取容器内的配置文件（最可靠）

```bash
docker exec napcat-qce cat /root/.qq-chat-exporter/security.json
```

用文本编辑器查看输出的内容，其中 `accessToken` 字段对应的那串字符就是你的登录令牌。

---

### 访问前端管理界面

打开浏览器，访问：

```
http://localhost:40653/qce
```

在弹出的访问验证页面中，将上一步获取到的 `accessToken` 令牌复制并粘贴进去，点击验证即可进入。

---

### 使用预构建镜像

默认的 Compose 文件是在本地实时构建镜像。如果你不想在本地花费时间编译，可以直接使用官方提供的预构建镜像。

用文本编辑器打开 `docker/docker-compose.yml`，**取消注释** `image` 行，并**注释掉** `build` 相关的代码块：

```yaml
services:
  napcat-qce:
    image: ghcr.io/shuakami/napcat-qce:latest
    # build:
    #   context: ..
    #   dockerfile: docker/Dockerfile
```

---

### 数据持久化说明

为了确保容器重启或更新后账号登录状态和导出的数据不丢失，建议关注以下持久化挂载卷：

| 挂载卷名称 / 宿主机路径 | 容器内对应路径 | 具体用途说明 |
| --- | --- | --- |
| `qq-session` | `/app/.config/QQ` | 存放 QQ 客户端的本地登录会话与缓存，避免重复扫码。 |
| `qce-data` | `/root/.qq-chat-exporter` | 存放你导出的聊天记录和下载的媒体附件。 |
| `./config` | `/app/napcat/config` | 存放 NapCat 自身的运行配置文件。 |

---

### macOS / Apple Silicon (M1/M2/M3) 特别说明

在 Docker Compose 配置文件中，我们默认指定了 `platform: linux/amd64`。这可以确保镜像在 Apple Silicon 芯片的 Mac 上能够通过系统的 Rosetta 2 虚拟化技术正常模拟运行 x86_64 架构的容器。

*提示：由于存在架构模拟转换，首次拉起容器并启动环境可能需要等待 1-2 分钟，请耐心观察日志输出。*

---

## 进阶方式：手动挂载到现有 NapCat Docker

如果你原本就已经在服务器上部署并运行了现成的 NapCat 容器，可以选择只将 QCE 作为插件和前端静态资源手动挂载进去。

### 前提条件

* 已经有正在运行的 NapCat Docker 容器（基于官方 `mlikiowa/napcat-docker:latest` 镜像部署）。
* 你的 NapCat 核心版本必须大于或等于 `v4.17`（需要利用插件上下文的 `oneBot` 属性）。

---

### 期望的目录结构

在宿主机上，你需要调整并准备好如下所示的目录结构：

```
napcat/
├── docker-compose.yml
├── config/
│   ├── napcat_<你的QQ号>.json
│   └── plugins.json           ← 必须手动创建，用于启用插件
├── plugins/
│   ├── napcat-plugin-builtin/ ← 必须先从容器内部复制出来
│   └── napcat-plugin-qce/     ← 存放 QCE 插件核心文件
└── qce/                       ← 存放前端静态网页文件
```

---

### 部署具体步骤

#### 1. 备份并复制内置插件

由于后续要直接挂载宿主机的 `plugins/` 目录，这会完全覆盖掉容器内部自带的插件。因此，你必须先将容器内原有的内置插件复制到宿主机本地：

```bash
# 创建本地插件文件夹
mkdir -p plugins

# 将容器内自带的内置插件复制出来（假设你的容器名叫 napcat）
docker cp napcat:/app/napcat/plugins/napcat-plugin-builtin plugins/napcat-plugin-builtin
```

#### 2. 解压并提取 QCE 插件与前端资源

前往 [GitHub Releases](https://github.com/shuakami/qq-chat-exporter/releases) 页面下载最新的 Linux Shell 模式包（`.tar.gz` 压缩包），解压后将其中的插件和前端提取出来：

```bash
# 解压 Release 包到临时目录
tar -xzf NapCat-QCE-*.tar.gz -C /tmp/qce-release

# 将 QCE 插件目录复制到本地的 plugins 文件夹中
cp -r /tmp/qce-release/plugins/napcat-plugin-qce plugins/

# 将前端静态网页文件复制到本地的 qce 文件夹中
cp -r /tmp/qce-release/static/qce ./qce
```

#### 3. ARM64 架构适配提示

QCE 核心运行依赖一个原生的 Rust 二进制服务端文件（`qce-server`）。插件在启动时，会自动调用与当前系统架构相匹配的二进制文件。

* **重要限制**：官方编译包目前仅直接提供 x64 架构的二进制文件。如果你使用的是 ARM64（树莓派等）宿主机环境，请勿直接使用 Release 的打包文件。请直接使用本仓库自带的 Dockerfile 在你的目标机器上执行本地编译构建，Rust 构建阶段会自动产出对应你机器架构的 ARM64 二进制文件。

#### 4. 在配置中启用插件

NapCat 默认只会加载内置插件。你需要手动编辑宿主机上的 `config/plugins.json` 文件（如果没有则新建），显式将 QCE 插件声明为启用状态：

```json
{
  "napcat-plugin-builtin": true,
  "napcat-plugin-qce": true
}
```

#### 5. 修改 `docker-compose.yml` 配置文件

更新你的 Docker Compose 配置文件，将本地准备好的插件目录和前端静态资源挂载路径追加进去：

```yaml
services:
  app:
    image: 'mlikiowa/napcat-docker:latest'
    container_name: napcat
    restart: unless-stopped
    volumes:
      - ./config:/app/napcat/config
      - /app/.config/QQ:/app/.config/QQ
      - ./plugins:/app/napcat/plugins          # 挂载合并后的插件目录
      - ./qce:/app/napcat/static/qce           # 挂载前端静态网页资源
    networks:
      - web-internal

networks:
  web-internal:
    external: true
```

#### 6. 启动容器并验证日志

```bash
# 重新拉起容器
docker compose up -d

# 过滤并检查关键插件日志
docker logs -f napcat 2>&1 | grep -i "plugin\|qce\|chat-exporter"
```

当你在实时日志中观察到以下输出，表明挂载完全成功：

```
[Plugins] 加载插件: napcat-plugin-builtin
[Plugins] 加载插件: napcat-plugin-qce
[QQChatExporter] API server started (Rust). Web UI: http://127.0.0.1:40653/qce
```

---

### 7. 配置反向代理与 HTTPS（可选进阶）

QCE 的底层 API 服务默认在容器内的 `40653` 端口监听。如果你需要将该界面发布到外网并使用安全域名的 HTTPS 形式访问，可以采用以下反向代理配置：

#### Nginx Proxy Manager (图形化管理面板) 配置方法：

* **Domain Names**: `qce.yourdomain.com`
* **Forward Scheme**: `http`
* **Forward Host/IP**: `napcat` (如果二者在同一个 Docker 自定义网络下，直接填容器名；否则填宿主机局域网 IP)
* **Forward Port**: `40653`
* **Websockets Support**: **必须开启**（QCE 依靠 WebSocket 实时向前端推送聊天记录的导出任务进度）。
* **SSL**: 正常申请或选择你的 SSL 证书，并勾选 Force SSL。

#### 传统 Nginx 手动配置文件示例：

```nginx
server {
    listen 443 ssl;
    server_name qce.yourdomain.com;

    # 请根据实际情况配置文件路径
    ssl_certificate /etc/nginx/ssl/qce.crt;
    ssl_certificate_key /etc/nginx/ssl/qce.key;

    location / {
        proxy_pass http://napcat:40653;
        proxy_http_version 1.1;

        # 必须配置以下三行以完美支持 WebSocket 进度推送
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 常见问题

### 提示 `qce-server` 启动失败，或者报错 `exec format error`（格式错误）

* **原因**：宿主机架构与二进制文件不匹配。通常是因为你在 ARM64 架构的机器上直接挂载了官方 Release 包中预编译的 x64 二进制文件。请参考步骤 3，在你的机器上通过本地 Dockerfile 重新构建镜像。

### 插件未加载（查看日志完全没有加载 QCE 的相关输出）

* **原因**：NapCat 没有识别到插件开关。请检查你宿主机挂载的 `config/plugins.json` 文件，确认该文件内容格式正确，且已经包含了 `"napcat-plugin-qce": true` 配置。

### 网页打开后提示 404 错误

* **原因**：前端静态资源未正确识别。请检查你宿主机本地的 `qce/` 目录下是否包含 `index.html` 以及 `_next/` 文件夹。同时，核对 `docker-compose.yml` 中的挂载右侧路径，必须精确挂载到容器内部的 `/app/napcat/static/qce` 路径下。

### 导出的聊天记录文件保存在哪里？

* **原因**：所有通过网页前端成功创建并执行完的导出任务，其生成的文件默认都存放在容器内部的 `/root/.qq-chat-exporter/exports/` 目录下。你不需要去容器底层翻找，直接在已经登录的 QCE 网页操作界面上的“任务”板块中，即可直接点击下载到你的本地电脑上。
