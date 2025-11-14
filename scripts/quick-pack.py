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

VERSION = "4.0.0-test"

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
    print("[1/12] Getting NapCat latest version...")
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
    pack_dir = f"NapCat-QCE-{os_name}-{arch}"
    print(f"[*] Platform: {os_name} {arch}")
    print(f"[*] Package: {pack_dir}")
    print()
    
    # Get NapCat version
    napcat_version = get_napcat_latest_version()
    napcat_url = f"https://github.com/NapNeko/NapCatQQ/releases/download/{napcat_version}/NapCat.Shell.zip"
    print()
    
    # Clean old files
    print("[2/12] Cleaning old files...")
    if os.path.exists(pack_dir):
        shutil.rmtree(pack_dir)
    if os.path.exists("NapCat.Shell.zip"):
        os.remove("NapCat.Shell.zip")
    if os.path.exists("temp_napcat_extract"):
        shutil.rmtree("temp_napcat_extract")
    print("[x] Cleaned")
    print()
    
    # Download NapCat
    print(f"[3/12] Downloading NapCat.Shell {napcat_version}...")
    try:
        download_file(napcat_url, "NapCat.Shell.zip")
    except Exception as e:
        print(f"[!] Download failed: {e}")
        sys.exit(1)
    print()
    
    # Extract NapCat
    print("[4/12] Extracting NapCat.Shell...")
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
    
    print("[x] Extracted")
    print()
    
    # Create plugin directories
    print("[5/12] Creating plugin directories...")
    os.makedirs(f"{pack_dir}/plugins", exist_ok=True)
    os.makedirs(f"{pack_dir}/static", exist_ok=True)
    print("[x] Created")
    print()
    
    # Copy plugin files
    print("[6/12] Copying plugin files...")
    copy_directory("plugins/qq-chat-exporter", f"{pack_dir}/plugins/qq-chat-exporter")
    print("[x] Copied")
    print()
    
    # Install plugin dependencies
    print("[7/12] Installing plugin dependencies...")
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
    print("[8/12] Copying frontend files...")
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
    print("[9/12] Updating config files...")
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
    
    print("[9.5/12] Creating launcher script...")

    if os_name == "Windows":
        launcher_script = r"""@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem NapCat + QCE Launcher Script

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR%"=="" set "SCRIPT_DIR=.\"
pushd "%SCRIPT_DIR%" >nul

set "NAPCAT_MAIN_PATH=%SCRIPT_DIR%napcat.mjs"
if not exist "%NAPCAT_MAIN_PATH%" (
    echo [NapCat + QCE] 错误: 未找到 napcat.mjs
    echo 请确认已完整解压安装包后再试。
    pause
    exit /b 1
)

set "ORIGINAL_NODE_OPTIONS=%NODE_OPTIONS%"
set "SELECTED_HEAP=%NAPCAT_NODE_HEAP%"
if not defined SELECTED_HEAP set "SELECTED_HEAP=6144"

if /I "!SELECTED_HEAP!"=="auto" set "SELECTED_HEAP="
if /I "!SELECTED_HEAP!"=="default" set "SELECTED_HEAP="

for /f "tokens=*" %%I in ("!SELECTED_HEAP!") do set "SELECTED_HEAP=%%I"

if defined SELECTED_HEAP (
    echo.
    echo [NapCat + QCE] 使用 Node.js 内存上限: !SELECTED_HEAP! MB
    if defined ORIGINAL_NODE_OPTIONS (
        set "NODE_OPTIONS=--max-old-space-size=!SELECTED_HEAP! !ORIGINAL_NODE_OPTIONS!"
    ) else (
        set "NODE_OPTIONS=--max-old-space-size=!SELECTED_HEAP!"
    )
) else (
    echo.
    echo [NapCat + QCE] 使用 Node.js 默认内存上限。
    set "NODE_OPTIONS=!ORIGINAL_NODE_OPTIONS!"
)

echo.
echo [NapCat + QCE] 正在启动 NapCat...
echo 按 Ctrl+C 停止运行。
echo.

node "%NAPCAT_MAIN_PATH%"

set "NODE_OPTIONS=!ORIGINAL_NODE_OPTIONS!"
popd >nul
echo.
pause
"""
        launcher_path = f"{pack_dir}/launcher-user.bat"
        with open(launcher_path, "w", encoding="utf-8", newline="\r\n") as f:
            f.write(launcher_script)
    else:
        launcher_script = """#!/bin/bash
# NapCat + QCE Launcher Script

set -e

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

NAPCAT_MAIN_PATH="$SCRIPT_DIR/napcat.mjs"

if [ ! -f "$NAPCAT_MAIN_PATH" ]; then
  echo "[NapCat + QCE] 错误: 未找到 napcat.mjs"
  echo "请确认已完整解压安装包后再试。"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[NapCat + QCE] 错误: 未检测到 Node.js"
  echo "请先安装 Node.js 18+ (https://nodejs.org)"
  exit 1
fi

ORIGINAL_NODE_OPTIONS="${NODE_OPTIONS:-}"
SELECTED_HEAP="${NAPCAT_NODE_HEAP:-6144}"

case "${SELECTED_HEAP}" in
  ""|auto|default|AUTO|DEFAULT)
    echo
    echo "[NapCat + QCE] 使用 Node.js 默认内存上限。"
    NODE_OPTIONS="$ORIGINAL_NODE_OPTIONS"
    ;;
  *)
    echo
    echo "[NapCat + QCE] 使用 Node.js 内存上限: ${SELECTED_HEAP} MB"
    if [ -n "$ORIGINAL_NODE_OPTIONS" ]; then
      NODE_OPTIONS="--max-old-space-size=${SELECTED_HEAP} ${ORIGINAL_NODE_OPTIONS}"
    else
      NODE_OPTIONS="--max-old-space-size=${SELECTED_HEAP}"
    fi
    ;;
esac

export NODE_OPTIONS

echo
echo "[NapCat + QCE] 正在启动 NapCat..."
echo "按 Ctrl+C 可随时停止。"
echo

node "$NAPCAT_MAIN_PATH"

# 恢复原有 NODE_OPTIONS
NODE_OPTIONS="$ORIGINAL_NODE_OPTIONS"
export NODE_OPTIONS
"""
        launcher_path = f"{pack_dir}/launcher-user.sh"
        with open(launcher_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(launcher_script)

        import stat
        os.chmod(launcher_path, os.stat(launcher_path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    print("[x] Created")
    print()
    
    # Create README
    print("[10/12] Creating README...")
    
    if os_name == "Windows":
        usage_steps = """Usage:
1. Extract to any directory
2. Run: launcher-user.bat
3. Browser: http://localhost:40653/qce-v4-tool
   Enter the token shown in console"""
    else:  # Linux/macOS
        usage_steps = """Usage:
1. Extract to any directory
2. Run: ./launcher-user.sh
3. Browser: http://localhost:40653/qce-v4-tool
   Enter the token shown in console

Note: First run, execute: chmod +x launcher-user.sh"""
        if os_name == "Linux":
            usage_steps += "\n      QQ must be installed at /opt/QQ or set NAPCAT_QQ_PATH"
        else:  # macOS
            usage_steps += "\n      Run: xattr -r -d com.apple.quarantine . to remove system quarantine"
    
    readme_content = f"""{"=" * 50}
NapCat + QQ Chat Exporter - Complete Package
{"=" * 50}
NapCat Version: {napcat_version}
QCE Version: {VERSION}
Platform: {os_name}-{arch}
Build Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
{"=" * 50}

Complete package includes:
- NapCat {napcat_version}
- QQ Chat Exporter Plugin {VERSION}
- Pre-configured web interface

{usage_steps}

Requirements:
- QQ Client 34606+ (recommended 9.9.19-34740)
- Download: https://im.qq.com/

Support:
- NapCat: https://github.com/NapNeko/NapCatQQ
- QCE Plugin: https://github.com/shuakami/qq-chat-exporter
{"=" * 50}
"""
    
    with open(f"{pack_dir}/README.txt", "w", encoding="utf-8") as f:
        f.write(readme_content)
    
    print("[x] Created")
    print()
    
    # Create main archive
    print("[11/12] Creating main archive...")
    output_file = f"{pack_dir}{archive_ext}"
    create_archive(pack_dir, output_file, archive_ext)
    print()
    
    # Create qce-viewer standalone package
    print("[12/12] Creating qce-viewer standalone package...")
    viewer_pack_dir = "qce-viewer-standalone"
    
    # Clean old viewer package
    if os.path.exists(viewer_pack_dir):
        shutil.rmtree(viewer_pack_dir)
    if os.path.exists("qce-viewer.zip"):
        os.remove("qce-viewer.zip")
    
    # Copy qce-viewer
    copy_directory("qce-viewer", viewer_pack_dir)
    
    # Install dependencies
    print("[->] Installing qce-viewer dependencies...")
    npm_cmd = ["npm.cmd" if os_name == "Windows" else "npm", "install", "--omit=dev"]
    if not run_command(npm_cmd, cwd=viewer_pack_dir):
        print("[!] qce-viewer dependency install failed")
        sys.exit(1)
    
    # Create qce-viewer README
    viewer_readme = f"""{"=" * 50}
QCE Viewer - Standalone Export Viewer
{"=" * 50}
Version: {VERSION}
Build Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
{"=" * 50}

Lightweight viewer for browsing exported QQ chat records.

Usage:
1. Windows: Run start.bat
2. Linux/macOS: Run ./start.sh (chmod +x start.sh first)
3. Browser: http://localhost:3000

Features:
- Browse all exported chat records
- Search and filter chats
- View messages, images, and other resources
- No QQ login required

Requirements:
- Node.js 16+ (https://nodejs.org/)

Support:
- GitHub: https://github.com/shuakami/qq-chat-exporter
{"=" * 50}
"""
    
    with open(f"{viewer_pack_dir}/README.txt", "w", encoding="utf-8") as f:
        f.write(viewer_readme)
    
    # Create qce-viewer.zip (always ZIP regardless of platform)
    viewer_output = "qce-viewer.zip"
    with zipfile.ZipFile(viewer_output, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(viewer_pack_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, os.path.dirname(viewer_pack_dir))
                zipf.write(file_path, arcname)
    
    viewer_size = os.path.getsize(viewer_output)
    print(f"[x] Created: {viewer_output} ({viewer_size / 1024 / 1024:.2f} MB)")
    print()
    
    # Clean up
    if os.path.exists("NapCat.Shell.zip"):
        os.remove("NapCat.Shell.zip")
    if os.path.exists("temp_napcat_extract"):
        shutil.rmtree("temp_napcat_extract")
    if os.path.exists(viewer_pack_dir):
        shutil.rmtree(viewer_pack_dir)
    
    # Summary
    print("=" * 50)
    print("[x] All Packages Complete!")
    print("=" * 50)
    print()
    print("Output Files:")
    print(f"1. {output_file}")
    print(f"   Size: {os.path.getsize(output_file) / 1024 / 1024:.2f} MB")
    print(f"   Complete package with NapCat {napcat_version}")
    print()
    print(f"2. {viewer_output}")
    print(f"   Size: {viewer_size / 1024 / 1024:.2f} MB")
    print(f"   Standalone viewer for exported chat records")
    print()
    print("Main Package Usage:")
    print("1. Extract to any directory")
    print(f"2. Run launcher-user.{'bat' if os_name == 'Windows' else 'sh'}")
    print("3. Visit http://localhost:40653/qce-v4-tool")
    print()
    print("Viewer Package Usage:")
    print("1. Extract to any directory")
    print(f"2. Run start.{'bat' if os_name == 'Windows' else 'sh'}")
    print("3. Visit http://localhost:3000")
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

