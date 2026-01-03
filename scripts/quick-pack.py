#!/usr/bin/env python3
"""QCE Plugin Complete Package Builder - Cross Platform"""

import os
import sys
import json
import shutil
import platform
import subprocess
import zipfile
import tarfile
from pathlib import Path
from urllib.request import urlretrieve, urlopen
from datetime import datetime

def get_qce_version():
    """Get QCE version from package.json or environment variable"""
    # Priority: QCE_VERSION env > package.json
    if os.environ.get('QCE_VERSION'):
        return os.environ['QCE_VERSION'].lstrip('v')
    
    try:
        with open('plugins/qq-chat-exporter/package.json', 'r', encoding='utf-8') as f:
            pkg = json.load(f)
            return pkg.get('version', 'unknown')
    except:
        return 'unknown'

VERSION = get_qce_version()

def get_platform_info():
    """Detect current platform"""
    system = platform.system()
    machine = platform.machine().lower()
    
    if system == "Windows":
        return "Windows", "x64", ".zip"
    elif system == "Darwin":
        arch = "arm64" if machine == "arm64" else "x64"
        return "macOS", arch, ".tar.gz"
    elif system == "Linux":
        return "Linux", "x64", ".tar.gz"
    else:
        print(f"[!] Unsupported platform: {system}")
        sys.exit(1)

def get_napcat_latest_version():
    """Get latest NapCat version from GitHub API"""
    print("[1/11] Getting NapCat latest version...")
    try:
        with urlopen("https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest") as response:
            data = json.loads(response.read())
            version = data["tag_name"]
            print(f"[x] Detected NapCat version: {version}")
            return version
    except Exception as e:
        print(f"[!] Failed to get latest version: {e}")
        print("[!] Using default version v4.8.119")
        return "v4.8.119"

def download_file(url, dest):
    """Download file with progress"""
    print(f"[->] Downloading: {url}")
    urlretrieve(url, dest)
    print(f"[x] Downloaded: {dest}")

def run_command(cmd, cwd=None, shell=False):
    """Run shell command"""
    result = subprocess.run(cmd, cwd=cwd, shell=shell, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[!] Command failed: {' '.join(cmd) if isinstance(cmd, list) else cmd}")
        print(f"[!] Error: {result.stderr}")
        return False
    return True

def extract_zip(zip_path, dest_dir):
    """Extract ZIP file"""
    print(f"[->] Extracting: {zip_path}")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(dest_dir)
    print(f"[x] Extracted to: {dest_dir}")

def copy_directory(src, dst):
    """Copy directory recursively"""
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst)

def create_archive(source_dir, output_file, format_type):
    """Create archive (zip or tar.gz)"""
    print(f"[->] Creating archive: {output_file}")
    
    if format_type == ".zip":
        with zipfile.ZipFile(output_file, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, os.path.dirname(source_dir))
                    zipf.write(file_path, arcname)
    else:
        with tarfile.open(output_file, "w:gz") as tar:
            tar.add(source_dir, arcname=os.path.basename(source_dir))
    
    size = os.path.getsize(output_file)
    print(f"[x] Created: {output_file} ({size / 1024 / 1024:.2f} MB)")

def main():
    print("=" * 50)
    print("NapCat + QCE Plugin - Complete Package Builder")
    print("=" * 50)
    print()
    
    # Detect platform
    os_name, arch, archive_ext = get_platform_info()
    
    # Get QCE version for output filename
    qce_version = VERSION
    print(f"[*] QCE Version: {qce_version}")
    
    # Directory name (without version for internal use)
    pack_dir = f"NapCat-QCE-{os_name}-{arch}"
    # Output filename (with version)
    output_basename = f"NapCat-QCE-{os_name}-{arch}-v{qce_version}"
    
    print(f"[*] Platform: {os_name} {arch}")
    print(f"[*] Package: {output_basename}")
    print()
    
    # Get NapCat version
    napcat_version = get_napcat_latest_version()
    napcat_url = f"https://github.com/NapNeko/NapCatQQ/releases/download/{napcat_version}/NapCat.Shell.zip"
    print()
    
    # Clean old files
    print("[2/11] Cleaning old files...")
    if os.path.exists(pack_dir):
        shutil.rmtree(pack_dir)
    if os.path.exists("NapCat.Shell.zip"):
        os.remove("NapCat.Shell.zip")
    if os.path.exists("temp_napcat_extract"):
        shutil.rmtree("temp_napcat_extract")
    print("[x] Cleaned")
    print()
    
    # Download NapCat
    print(f"[3/11] Downloading NapCat.Shell {napcat_version}...")
    try:
        download_file(napcat_url, "NapCat.Shell.zip")
    except Exception as e:
        print(f"[!] Download failed: {e}")
        sys.exit(1)
    print()
    
    # Extract NapCat
    print("[4/11] Extracting NapCat.Shell...")
    temp_extract_dir = "temp_napcat_extract"
    if os.path.exists(temp_extract_dir):
        shutil.rmtree(temp_extract_dir)
    os.makedirs(temp_extract_dir)
    extract_zip("NapCat.Shell.zip", temp_extract_dir)
    
    # Check if there's a NapCat.Shell subdirectory or if files are directly in temp dir
    extracted_napcat = os.path.join(temp_extract_dir, "NapCat.Shell")
    if os.path.exists(extracted_napcat):
        # If there's a NapCat.Shell subdirectory, move it
        shutil.move(extracted_napcat, pack_dir)
        shutil.rmtree(temp_extract_dir)
    else:
        # If files are directly in temp dir, rename the temp dir
        os.rename(temp_extract_dir, pack_dir)
    
    # Fix NapCat bug: loadNapCat.js has wrong path (./napcat/napcat.mjs instead of ./napcat.mjs)
    load_napcat_path = os.path.join(pack_dir, "loadNapCat.js")
    if os.path.exists(load_napcat_path):
        print("[4.1/11] Fixing loadNapCat.js path bug...")
        fixed_content = '''const path = require('path');
const CurrentPath = path.dirname(__filename);
(async () => {
  await import('file://' + path.join(CurrentPath, './napcat.mjs'));
})();
'''
        with open(load_napcat_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(fixed_content)
        print("[x] Fixed loadNapCat.js")
    
    print("[x] Extracted")
    print()
    
    # Create plugin directories
    print("[5/11] Creating plugin directories...")
    os.makedirs(f"{pack_dir}/plugins", exist_ok=True)
    os.makedirs(f"{pack_dir}/static", exist_ok=True)
    print("[x] Created")
    print()
    
    # Copy plugin files
    print("[6/11] Copying plugin files...")
    copy_directory("plugins/qq-chat-exporter", f"{pack_dir}/plugins/qq-chat-exporter")
    print("[x] Copied")
    print()
    
    # Install plugin dependencies
    print("[7/11] Installing plugin dependencies...")
    plugin_dir = f"{pack_dir}/plugins/qq-chat-exporter"
    npm_cmd = ["npm.cmd" if os_name == "Windows" else "npm", "install", "--omit=dev"]
    if not run_command(npm_cmd, cwd=plugin_dir):
        print("[!] Dependency install failed")
        sys.exit(1)
    print("[x] Installed")
    print()
    
    # Generate Overlay runtime files
    print("[7.5/11] Generating Overlay runtime files...")
    node_cmd = ["node.exe" if os_name == "Windows" else "node", "tools/create-overlay-runtime.cjs"]
    if not run_command(node_cmd, cwd=plugin_dir):
        print("[!] Overlay generation failed")
        sys.exit(1)
    print("[x] Generated")
    print()
    
    # Copy frontend files
    print("[8/11] Copying frontend files...")
    frontend_out = "qce-v4-tool/out"
    if not os.path.exists(f"{frontend_out}/index.html"):
        print("[-] Building frontend...")
        pnpm_cmd = "pnpm.cmd" if os_name == "Windows" else "pnpm"
        run_command([pnpm_cmd, "install"], cwd="qce-v4-tool")
        run_command([pnpm_cmd, "run", "build"], cwd="qce-v4-tool")
    copy_directory(frontend_out, f"{pack_dir}/static/qce-v4-tool")
    print("[x] Copied")
    print()
    
    # Update config files
    print("[9/11] Updating config files...")
    os.makedirs(f"{pack_dir}/config", exist_ok=True)
    
    napcat_config = {
        "fileLog": False,
        "consoleLog": True,
        "fileLogLevel": "debug",
        "consoleLogLevel": "info",
        "packetBackend": "auto",
        "packetServer": "",
        "o3HookMode": 1,
        "plugins": {
            "enable": True,
            "list": [
                {
                    "name": "qq-chat-exporter",
                    "enable": True,
                    "path": "./plugins/qq-chat-exporter/index.mjs"
                }
            ]
        }
    }
    
    onebot_config = {
        "network": {
            "httpServers": [],
            "httpSseServers": [],
            "httpClients": [],
            "websocketServers": [],
            "websocketClients": []
        },
        "musicSignUrl": "",
        "enableLocalFile2Url": True,
        "parseMultMsg": False,
        "debug": False,
        "heartInterval": 30000,
        "messagePostFormat": "array",
        "reportSelfMessage": False,
        "token": ""
    }
    
    with open(f"{pack_dir}/config/napcat.json", "w") as f:
        json.dump(napcat_config, f, indent=2)
    
    with open(f"{pack_dir}/config/onebot11.json", "w") as f:
        json.dump(onebot_config, f, indent=2)
    
    print("[x] Updated")
    print()
    
    # Pre-compile qq_magic.so for Linux (fixes qq_magic_napi_register symbol issue)
    if os_name == "Linux":
        print("[9.3/11] Pre-compiling qq_magic.so for Linux...")
        
        # Create the C++ source file
        qq_magic_cpp = '''#include <node_api.h>
extern "C" {
    void qq_magic_napi_register(napi_module *m) {
        napi_module_register(m);
    }
}
'''
        cpp_path = f"{pack_dir}/qq_magic.cpp"
        so_path = f"{pack_dir}/qq_magic.so"
        
        with open(cpp_path, "w", encoding="utf-8") as f:
            f.write(qq_magic_cpp)
        
        # Try to compile
        compile_success = run_command(["g++", "-shared", "-fPIC", "-o", so_path, cpp_path])
        
        if compile_success and os.path.exists(so_path):
            print("[x] qq_magic.so compiled successfully")
            os.remove(cpp_path)  # Clean up source file
        else:
            print("[!] Warning: Could not pre-compile qq_magic.so")
            print("[!] Users will need to compile it manually or install build-essential")
            if os.path.exists(cpp_path):
                os.remove(cpp_path)
        print()
    
    # Create standalone mode scripts
    print("[9.5/11] Creating standalone mode scripts...")
    
    # Create standalone.mjs entry point
    standalone_mjs = '''#!/usr/bin/env node
/**
 * QCE 独立模式启动脚本
 * 无需 NapCat 登录即可运行，用于浏览已导出的聊天记录和资源
 */

async function main() {
    const port = parseInt(process.argv[2]) || 40653;
    
    console.log('[QCE] 正在启动独立模式...');
    
    try {
        // 使用 tsx 加载 TypeScript
        const tsx = await import('tsx/esm/api');
        tsx.register();
        
        // 动态导入 StandaloneServer
        const { startStandaloneServer } = await import('./lib/api/StandaloneServer.ts');
        
        await startStandaloneServer(port);
        
        // 保持进程运行
        process.on('SIGINT', () => {
            console.log('\\n[QCE] 正在关闭...');
            process.exit(0);
        });
    } catch (error) {
        console.error('[QCE] 启动失败:', error);
        process.exit(1);
    }
}

main();
'''
    
    with open(f"{pack_dir}/plugins/qq-chat-exporter/standalone.mjs", "w", encoding="utf-8", newline="\n") as f:
        f.write(standalone_mjs)
    
    # Create Windows batch launcher for standalone mode
    if os_name == "Windows":
        standalone_bat = '''@echo off
chcp 65001 > nul
title QCE 独立模式

echo.
echo [QCE] 独立模式
echo [QCE] 无需登录QQ即可浏览已导出的聊天记录
echo.

:: 检查 Node.js - 首先尝试使用打包的 Node
set "NODE_EXE="

:: 检查是否有打包的 Node.js
if exist "%~dp0node.exe" (
    set "NODE_EXE=%~dp0node.exe"
    goto :found_node
)

:: 检查系统 Node.js
where node >nul 2>&1
if %errorlevel% equ 0 (
    set "NODE_EXE=node"
    goto :found_node
)

:: 未找到 Node.js
echo [错误] 未检测到 Node.js
echo.
echo 解决方案:
echo   1. 安装 Node.js: https://nodejs.org/
echo   2. 或使用完整版 NapCat+QCE 包（运行 launcher-user.bat）
echo.
pause
exit /b 1

:found_node
echo [信息] 正在启动独立模式服务器...
echo.
"%NODE_EXE%" plugins/qq-chat-exporter/standalone.mjs %1

pause
'''
        with open(f"{pack_dir}/start-standalone.bat", "w", encoding="utf-8") as f:
            f.write(standalone_bat)
    
    # Create Linux/macOS shell launcher for standalone mode
    if os_name != "Windows":
        standalone_sh = '''#!/bin/bash
# QCE 独立模式启动脚本

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo ""
echo "[QCE] 独立模式"
echo "[QCE] 无需登录QQ即可浏览已导出的聊天记录"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[错误] 未检测到 Node.js"
    echo ""
    echo "解决方案:"
    echo "  1. 安装 Node.js: https://nodejs.org/"
    echo "  2. 或使用完整版 NapCat+QCE 包（运行 ./launcher-user.sh）"
    echo ""
    exit 1
fi

echo "[信息] 正在启动独立模式服务器..."
echo ""
node plugins/qq-chat-exporter/standalone.mjs "$@"
'''
        standalone_sh_path = f"{pack_dir}/start-standalone.sh"
        with open(standalone_sh_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(standalone_sh)
        
        # Make it executable
        import stat
        os.chmod(standalone_sh_path, os.stat(standalone_sh_path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    
    print("[x] Created standalone scripts")
    print()
    
    # Create launcher script for Linux/macOS
    if os_name != "Windows":
        print("[9.6/11] Creating launcher script...")
        launcher_script = """#!/bin/bash
# NapCat + QCE Launcher Script

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Set environment variables
export NAPCAT_MAIN_PATH="$SCRIPT_DIR/napcat.mjs"

# Auto-detect QQ path if not set
if [ -z "$NAPCAT_QQ_PATH" ]; then
    if [ -f "/opt/QQ/qq" ]; then
        export NAPCAT_QQ_PATH="/opt/QQ/qq"
    elif [ -f "/usr/share/QQ/qq" ]; then
        export NAPCAT_QQ_PATH="/usr/share/QQ/qq"
    elif [ -f "/opt/linuxqq/qq" ]; then
        export NAPCAT_QQ_PATH="/opt/linuxqq/qq"
    elif [ -f "/Applications/QQ.app/Contents/MacOS/QQ" ]; then
        export NAPCAT_QQ_PATH="/Applications/QQ.app/Contents/MacOS/QQ"
    else
        echo "[Warning] QQ not found in default paths."
        echo "Please set NAPCAT_QQ_PATH environment variable:"
        echo "  export NAPCAT_QQ_PATH=/path/to/qq"
        echo ""
    fi
fi

echo "[Info] QQ Path: ${NAPCAT_QQ_PATH:-auto-detect}"

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Linux: Load pre-compiled qq_magic.so for qq_magic_napi_register symbol
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    QQ_MAGIC_SO="$SCRIPT_DIR/qq_magic.so"
    
    # Set LD_PRELOAD if qq_magic.so exists (pre-compiled in package)
    if [ -f "$QQ_MAGIC_SO" ]; then
        export LD_PRELOAD="$QQ_MAGIC_SO${LD_PRELOAD:+:$LD_PRELOAD}"
        echo "[Info] LD_PRELOAD set: $QQ_MAGIC_SO"
    fi
fi

# Run NapCat
echo "Starting NapCat + QCE..."
echo "Press Ctrl+C to stop"
echo ""

node "$NAPCAT_MAIN_PATH"
"""
        launcher_path = f"{pack_dir}/launcher-user.sh"
        with open(launcher_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(launcher_script)
        
        # Make it executable
        os.chmod(launcher_path, os.stat(launcher_path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        print("[x] Created")
        print()
    
    # Create README
    print("[10/11] Creating README...")
    
    if os_name == "Windows":
        usage_steps = """使用方法:
1. 解压到任意目录
2. 完整模式: 运行 launcher-user.bat (需要登录QQ，支持导出新记录)
3. 独立模式: 运行 start-standalone.bat (无需登录，仅浏览已导出文件)
4. 浏览器访问: http://localhost:40653/qce-v4-tool
   完整模式需输入控制台显示的访问令牌

独立模式说明:
- 无需安装或登录QQ
- 可浏览已导出的聊天记录
- 可使用资源画廊（图片/视频/音频）
- 不支持导出新的聊天记录"""
    else:  # Linux/macOS
        usage_steps = """使用方法:
1. 解压到任意目录
2. 完整模式: 运行 ./launcher-user.sh (需要登录QQ，支持导出新记录)
3. 独立模式: 运行 ./start-standalone.sh (无需登录，仅浏览已导出文件)
4. 浏览器访问: http://localhost:40653/qce-v4-tool
   完整模式需输入控制台显示的访问令牌

注意: 首次运行需执行: chmod +x launcher-user.sh start-standalone.sh

独立模式说明:
- 无需安装或登录QQ
- 可浏览已导出的聊天记录
- 可使用资源画廊（图片/视频/音频）
- 不支持导出新的聊天记录

自定义QQ路径:
- 如果QQ安装在非标准位置，可设置环境变量:
  export NAPCAT_QQ_PATH=/your/custom/path/qq
  ./launcher-user.sh"""
        if os_name == "Linux":
            usage_steps += """

默认支持的QQ路径: /opt/QQ/qq, /usr/share/QQ/qq, /opt/linuxqq/qq

Linux 说明:
- 已预编译 qq_magic.so 解决 qq_magic_napi_register 符号问题
- 启动脚本会自动加载，无需额外配置"""
        else:  # macOS
            usage_steps += "\n\nmacOS 用户: 运行 xattr -r -d com.apple.quarantine . 移除系统隔离"
    
    readme_content = f"""{"=" * 50}
NapCat + QQ Chat Exporter - 完整包
{"=" * 50}
NapCat 版本: {napcat_version}
QCE 版本: {VERSION}
平台: {os_name}-{arch}
构建时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
{"=" * 50}

包含内容:
- NapCat {napcat_version}
- QQ Chat Exporter 插件 {VERSION}
- 预配置的 Web 界面
- 独立模式支持（无需登录QQ）

{usage_steps}

系统要求:
- QQ 客户端 34606+ (推荐 9.9.19-34740)
- 下载地址: https://im.qq.com/
- 独立模式需要 Node.js 18+

支持:
- NapCat: https://github.com/NapNeko/NapCatQQ
- QCE 插件: https://github.com/shuakami/qq-chat-exporter
{"=" * 50}
"""
    
    with open(f"{pack_dir}/README.txt", "w", encoding="utf-8") as f:
        f.write(readme_content)
    
    print("[x] Created")
    print()
    
    # Create main archive (with version in filename)
    print("[11/11] Creating main archive...")
    output_file = f"{output_basename}{archive_ext}"
    create_archive(pack_dir, output_file, archive_ext)
    print()
    
    # Clean up
    if os.path.exists("NapCat.Shell.zip"):
        os.remove("NapCat.Shell.zip")
    if os.path.exists("temp_napcat_extract"):
        shutil.rmtree("temp_napcat_extract")
    
    # Summary
    print("=" * 50)
    print("[x] Package Complete!")
    print("=" * 50)
    print()
    print("Output File:")
    print(f"  {output_file}")
    print(f"  Size: {os.path.getsize(output_file) / 1024 / 1024:.2f} MB")
    print(f"  NapCat: {napcat_version}")
    print()
    print("Usage:")
    print("1. Extract to any directory")
    print(f"2. Full mode: launcher-user.{'bat' if os_name == 'Windows' else 'sh'}")
    print(f"3. Standalone mode: start-standalone.{'bat' if os_name == 'Windows' else 'sh'}")
    print("4. Visit http://localhost:40653/qce-v4-tool")
    print()
    print("=" * 50)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n[!] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
