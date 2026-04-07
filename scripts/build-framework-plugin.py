#!/usr/bin/env python3
"""
NapCat Framework + QCE 完整包构建器
下载 NapCat.Framework 并集成 QCE 插件
"""

import os
import sys
import json
import shutil
import subprocess
import zipfile
import platform
from pathlib import Path
from urllib.request import urlretrieve, urlopen
from datetime import datetime

def get_qce_version():
    """Get QCE version from environment or package.json"""
    if os.environ.get('QCE_VERSION'):
        return os.environ['QCE_VERSION'].lstrip('v')
    try:
        with open('plugins/qq-chat-exporter/package.json', 'r', encoding='utf-8') as f:
            return json.load(f).get('version', 'unknown')
    except:
        return 'unknown'

def get_napcat_latest_version():
    """Get latest NapCat version from GitHub API"""
    print("[*] Getting NapCat latest version...")
    try:
        with urlopen("https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest") as response:
            data = json.loads(response.read())
            version = data["tag_name"]
            print(f"[x] NapCat version: {version}")
            return version
    except Exception as e:
        print(f"[!] Failed to get latest version: {e}")
        return "v4.8.119"

def download_file(url, dest):
    """Download file"""
    print(f"[->] Downloading: {url}")
    urlretrieve(url, dest)
    print(f"[x] Downloaded: {dest}")

def run_command(cmd, cwd=None):
    """Run shell command"""
    result = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[!] Command failed: {cmd}")
        print(f"[!] Error: {result.stderr}")
        return False
    return True

def main():
    print("=" * 60)
    print("NapCat Framework + QCE Complete Package Builder")
    print("=" * 60)
    print()
    
    qce_version = get_qce_version()
    napcat_version = get_napcat_latest_version()
    
    # Framework 包是跨平台的（LiteLoader 插件）
    output_dir = "NapCat-Framework-QCE"
    output_zip = f"NapCat-Framework-QCE-v{qce_version}.zip"
    
    print(f"[*] QCE Version: {qce_version}")
    print(f"[*] NapCat Version: {napcat_version}")
    print(f"[*] Output: {output_zip}")
    print()
    
    # Clean
    print("[1/8] Cleaning old files...")
    for path in [output_dir, output_zip, "NapCat.Framework.zip"]:
        if os.path.exists(path):
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
    print("[x] Done")
    print()
    
    # Download NapCat.Framework
    print("[2/8] Downloading NapCat.Framework...")
    framework_url = f"https://github.com/NapNeko/NapCatQQ/releases/download/{napcat_version}/NapCat.Framework.zip"
    try:
        download_file(framework_url, "NapCat.Framework.zip")
    except Exception as e:
        print(f"[!] Download failed: {e}")
        sys.exit(1)
    print()
    
    # Extract NapCat.Framework
    print("[3/8] Extracting NapCat.Framework...")
    with zipfile.ZipFile("NapCat.Framework.zip", 'r') as zf:
        zf.extractall(output_dir)
    print("[x] Done")
    print()
    
    # Create plugins directory
    print("[4/8] Creating plugins directory...")
    plugins_dir = os.path.join(output_dir, "plugins")
    os.makedirs(plugins_dir, exist_ok=True)
    print("[x] Done")
    print()
    
    # Copy QCE plugin
    print("[5/8] Copying QCE plugin...")
    qce_dest = os.path.join(plugins_dir, "qq-chat-exporter")
    shutil.copytree("plugins/qq-chat-exporter", qce_dest)
    print("[x] Done")
    print()
    
    # Install plugin dependencies
    print("[6/8] Installing plugin dependencies...")
    os_name = platform.system()
    npm_cmd = ["npm.cmd" if os_name == "Windows" else "npm", "install", "--omit=dev"]
    if not run_command(npm_cmd, cwd=qce_dest):
        print("[!] Dependency install failed")
        sys.exit(1)
    print("[x] Done")
    print()
    
    # Generate overlay runtime
    print("[7/8] Generating overlay runtime...")
    node_cmd = ["node.exe" if os_name == "Windows" else "node", "tools/create-overlay-runtime.cjs"]
    if not run_command(node_cmd, cwd=qce_dest):
        print("[!] Overlay generation failed")
        sys.exit(1)
    print("[x] Done")
    print()
    
    # Update napcat.json config to enable QCE plugin
    print("[7.5/8] Updating NapCat config...")
    config_dir = os.path.join(output_dir, "config")
    os.makedirs(config_dir, exist_ok=True)
    
    napcat_config = {
        "fileLog": False,
        "consoleLog": True,
        "fileLogLevel": "debug",
        "consoleLogLevel": "info",
        "packetBackend": "auto",
        "packetServer": "",
        "o3HookMode": 1
    }

    plugins_config = {
        "qq-chat-exporter": True
    }

    with open(os.path.join(config_dir, "napcat.json"), "w", encoding="utf-8") as f:
        json.dump(napcat_config, f, indent=2, ensure_ascii=False)

    with open(os.path.join(config_dir, "plugins.json"), "w", encoding="utf-8") as f:
        json.dump(plugins_config, f, indent=2, ensure_ascii=False)
    print("[x] Done")
    print()
    
    # Copy frontend
    print("[7.6/8] Copying frontend...")
    frontend_out = "qce-v4-tool/out"
    static_dir = os.path.join(output_dir, "static", "qce-v4-tool")
    
    if os.path.exists(f"{frontend_out}/index.html"):
        shutil.copytree(frontend_out, static_dir)
        print("[x] Done")
    else:
        print("[-] Frontend not built, building...")
        pnpm_cmd = "pnpm.cmd" if os_name == "Windows" else "pnpm"
        run_command([pnpm_cmd, "install"], cwd="qce-v4-tool")
        run_command([pnpm_cmd, "run", "build"], cwd="qce-v4-tool")
        if os.path.exists(f"{frontend_out}/index.html"):
            shutil.copytree(frontend_out, static_dir)
            print("[x] Done")
        else:
            print("[!] Frontend build failed, skipping")
    print()
    
    # Create README
    build_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    readme_md = f"""# NapCat Framework + QQ Chat Exporter

- NapCat 版本：{napcat_version}
- QCE 版本：{qce_version}
- 构建时间：{build_time}

这是 Framework 模式的完整包，适合想让 QCE 和正在使用的 QQ 一起运行的场景，比如定时任务、后台备份。

## 安装步骤

1. 先按 LiteLoaderQQNT 官方文档完成安装：<https://liteloaderqqnt.github.io/>
2. 解压 `NapCat-Framework-QCE-v{qce_version}.zip`
3. 这个 Framework 包已经把需要的内容整合好了，普通用户直接解压后继续往下做就可以，不需要再手动挪文件夹
4. 如果当前 QQ 正在运行，先完全退出 QQ
5. 在解压后的目录里运行 `napiLoader.bat`
6. 如果 QQ 弹出登录页，按平时的方式登录 QQ
7. 访问 <http://localhost:40653/qce-v4-tool>

## 如何找到 token

按 `Win + R`，输入 `%USERPROFILE%\\.qq-chat-exporter` 并回车，打开 `security.json` 文件，找到 `accessToken` 字段。

## 相关链接

- NapCat: <https://napneko.github.io/>
- LiteLoaderQQNT: <https://liteloaderqqnt.github.io/>
- QCE: <https://github.com/shuakami/qq-chat-exporter>
"""
    readme_txt = f"""NapCat Framework + QQ Chat Exporter
NapCat 版本: {napcat_version}
QCE 版本: {qce_version}
构建时间: {build_time}

这是 Framework 模式的完整包，适合想让 QCE 和正在使用的 QQ 一起运行的场景，比如定时任务、后台备份。

安装步骤:
1. 先按 LiteLoaderQQNT 官方文档完成安装: https://liteloaderqqnt.github.io/
2. 解压 NapCat-Framework-QCE-v{qce_version}.zip
3. 这个 Framework 包已经把需要的内容整合好了，普通用户直接解压后继续往下做就可以，不需要再手动挪文件夹
4. 如果当前 QQ 正在运行，先完全退出 QQ
5. 在解压后的目录里运行 napiLoader.bat
6. 如果 QQ 弹出登录页，按平时的方式登录 QQ
7. 访问 http://localhost:40653/qce-v4-tool

如何找到 token:
按 Win + R，输入 %USERPROFILE%\\.qq-chat-exporter 并回车，打开 security.json 文件，找到 accessToken 字段。
"""
    with open(os.path.join(output_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme_md)
    with open(os.path.join(output_dir, "README.txt"), "w", encoding="utf-8") as f:
        f.write(readme_txt)
    
    # Create ZIP
    print("[8/8] Creating ZIP archive...")
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(output_dir):
            for file in files:
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, output_dir)
                zf.write(file_path, arcname)
    
    size_mb = os.path.getsize(output_zip) / 1024 / 1024
    print(f"[x] Created: {output_zip} ({size_mb:.2f} MB)")
    print()
    
    # Cleanup
    os.remove("NapCat.Framework.zip")
    
    print("=" * 60)
    print("[x] Build complete!")
    print("=" * 60)
    print()
    print(f"Output: {output_zip}")
    print()
    print("Framework 模式优势:")
    print("- 与 QQNT 共存，无需单独登录")
    print("- 支持定时备份")
    print("- 适合 Windows 桌面用户")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[!] Cancelled")
        sys.exit(1)
    except Exception as e:
        print(f"\n[!] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
