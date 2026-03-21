#!/bin/bash
# QQ Chat Exporter - Docker NapCat 部署辅助脚本
# 解决 esbuild 平台二进制文件不匹配的问题（如 x64 Release 包部署到 ARM64 容器）

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ARCH="$(uname -m)"
echo "[QCE Setup] 检测到架构: $ARCH"

# 获取当前 esbuild 版本
ESBUILD_VERSION=""
if [ -f "$PLUGIN_DIR/node_modules/esbuild/package.json" ]; then
    ESBUILD_VERSION=$(node -e "console.log(require('$PLUGIN_DIR/node_modules/esbuild/package.json').version)" 2>/dev/null || true)
fi

if [ -z "$ESBUILD_VERSION" ]; then
    echo "[QCE Setup] 未找到 esbuild，跳过平台适配"
    exit 0
fi

echo "[QCE Setup] esbuild 版本: $ESBUILD_VERSION"

# 根据架构确定需要的平台包
case "$ARCH" in
    x86_64|amd64)
        PLATFORM_PKG="@esbuild/linux-x64"
        ;;
    aarch64|arm64)
        PLATFORM_PKG="@esbuild/linux-arm64"
        ;;
    armv7l)
        PLATFORM_PKG="@esbuild/linux-arm"
        ;;
    *)
        echo "[QCE Setup] 未知架构 $ARCH，跳过"
        exit 0
        ;;
esac

# 检查是否已存在正确的平台包
PLATFORM_DIR="$PLUGIN_DIR/node_modules/$PLATFORM_PKG"
if [ -d "$PLATFORM_DIR" ]; then
    INSTALLED_VERSION=$(node -e "console.log(require('$PLATFORM_DIR/package.json').version)" 2>/dev/null || true)
    if [ "$INSTALLED_VERSION" = "$ESBUILD_VERSION" ]; then
        echo "[QCE Setup] $PLATFORM_PKG@$ESBUILD_VERSION 已安装，无需操作"
        exit 0
    fi
fi

echo "[QCE Setup] 安装 $PLATFORM_PKG@$ESBUILD_VERSION ..."

# 下载并解压平台包到 node_modules
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

npm pack "$PLATFORM_PKG@$ESBUILD_VERSION" --quiet 2>/dev/null
TARBALL=$(ls *.tgz 2>/dev/null | head -1)

if [ -z "$TARBALL" ]; then
    echo "[QCE Setup] 错误: 无法下载 $PLATFORM_PKG@$ESBUILD_VERSION"
    rm -rf "$TEMP_DIR"
    exit 1
fi

# 解压到正确位置
mkdir -p "$PLUGIN_DIR/node_modules/$PLATFORM_PKG"
tar -xzf "$TARBALL" -C "$PLUGIN_DIR/node_modules/$PLATFORM_PKG" --strip-components=1

# 清理
rm -rf "$TEMP_DIR"

echo "[QCE Setup] $PLATFORM_PKG@$ESBUILD_VERSION 安装完成"
