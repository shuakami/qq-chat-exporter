#!/bin/bash
set -e

# 检测平台和架构
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macOS"
    if [[ $(uname -m) == "arm64" ]]; then
        ARCH="arm64"
    else
        ARCH="x64"
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="Linux"
    ARCH="x64"
else
    echo "[错误] 不支持的平台: $OSTYPE"
    exit 1
fi

PACK_DIR="QCE-Plugin-${PLATFORM}-${ARCH}"
VERSION="4.0.0-test"

echo "========================================"
echo "QCE 插件 - 快速打包工具"
echo "平台: ${PLATFORM}-${ARCH}"
echo "========================================"
echo ""

echo "[1/8] 清理旧版本..."
rm -rf "${PACK_DIR}"
rm -f "${PACK_DIR}.tar.gz"
echo "[x] 清理完成"
echo ""

echo "[2/8] 创建目录结构..."
mkdir -p "${PACK_DIR}/plugins"
mkdir -p "${PACK_DIR}/static"
mkdir -p "${PACK_DIR}/config"
echo "[x] 目录已创建"
echo ""

echo "[3/8] 复制插件文件..."
cp -r plugins/qq-chat-exporter "${PACK_DIR}/plugins/"
echo "[x] 插件已复制"
echo ""

echo "[4/8] 安装插件依赖..."
cd "${PACK_DIR}/plugins/qq-chat-exporter"
npm install --omit=dev --silent
if [ $? -ne 0 ]; then
    echo "[错误] 依赖安装失败"
    cd ../../..
    exit 1
fi
cd ../../..
echo "[x] 依赖已安装"
echo ""

echo "[5/8] 复制前端文件..."
if [ ! -f "qce-v4-tool/out/index.html" ]; then
    echo "[-] 正在构建前端..."
    cd qce-v4-tool
    pnpm install
    pnpm run build
    cd ..
fi
cp -r qce-v4-tool/out "${PACK_DIR}/static/qce-v4-tool"
echo "[x] 前端已复制"
echo ""

echo "[6/8] 创建配置文件..."
cat > "${PACK_DIR}/config/napcat.json" << 'EOF'
{
  "fileLog": false,
  "consoleLog": true,
  "fileLogLevel": "debug",
  "consoleLogLevel": "info",
  "packetBackend": "auto",
  "packetServer": "",
  "o3HookMode": 1,
  "plugins": {
    "enable": true,
    "list": [
      {
        "name": "qq-chat-exporter",
        "enable": true,
        "path": "./plugins/qq-chat-exporter/index.mjs"
      }
    ]
  }
}
EOF

cat > "${PACK_DIR}/config/onebot11.json" << 'EOF'
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [],
    "websocketClients": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": true,
  "parseMultMsg": false,
  "debug": false,
  "heartInterval": 30000,
  "messagePostFormat": "array",
  "reportSelfMessage": false,
  "token": ""
}
EOF
echo "[x] 配置已创建"
echo ""

echo "[7/8] 创建使用说明..."
cat > "${PACK_DIR}/README.txt" << EOF
========================================
QQ 聊天记录导出插件
版本: ${VERSION}
平台: ${PLATFORM}-${ARCH}
构建时间: $(date)
========================================

安装方法 (3步):

[1] 解压到 NapCat.Shell 目录
    文件会自动合并:
    - plugins/qq-chat-exporter/  (插件文件)
    - static/qce-v4-tool/        (网页界面)
    - config/                     (已配置)

[2] 启动 NapCat: ./launcher-user.sh

[3] 浏览器访问: http://localhost:40653/qce-v4-tool

功能特性:
[-] 多格式导出 (HTML/JSON/TXT)
[-] 资源管理
[-] 定时导出
[-] 表情包导出
[-] 现代化网页界面

平台特别说明:
$(if [ "$PLATFORM" == "Linux" ]; then
    echo "- 必须在 QQ 安装目录 (/opt/QQ) 中运行"
    echo "- 或设置: export NAPCAT_QQ_PATH=/opt/QQ/qq"
elif [ "$PLATFORM" == "macOS" ]; then
    echo "- 首次运行: xattr -r -d com.apple.quarantine ."
    echo "- Apple Silicon 用户已优化性能"
fi)

技术支持: https://github.com/shuakami/qq-chat-exporter
========================================
EOF
echo "[x] 说明已创建"
echo ""

echo "[8/8] 创建 TAR.GZ 压缩包..."
tar -czf "${PACK_DIR}.tar.gz" -C . "${PACK_DIR}"
if [ $? -ne 0 ]; then
    echo "[错误] 压缩包创建失败，但打包目录已准备好"
    echo "您可以手动压缩 ${PACK_DIR} 文件夹"
else
    SIZE=$(du -h "${PACK_DIR}.tar.gz" | cut -f1)
    echo "[x] 压缩完成！"
    echo ""
    echo "========================================"
    echo "[x] 打包完成！"
    echo "========================================"
    echo ""
    echo "输出文件: ${PACK_DIR}.tar.gz"
    echo "文件大小: ${SIZE}"
    echo ""
    echo "使用方法:"
    echo "1. 解压到 NapCat.Shell 目录"
    echo "   tar -xzf ${PACK_DIR}.tar.gz"
    echo "2. 运行 ./launcher-user.sh"
    echo "3. 访问 http://localhost:40653/qce-v4-tool"
    echo "========================================"
fi

echo ""
echo "按任意键继续..."
read -n 1

