#!/usr/bin/env python3
"""
QCE Framework Plugin Builder
构建纯插件包，用于已安装 NapCat Framework 的用户
"""

import os
import sys
import json
import shutil
import subprocess
import zipfile
from pathlib import Path
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

def run_command(cmd, cwd=None):
    """Run shell command"""
    result = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[!] Command failed: {cmd}")
        print(f"[!] Error: {result.stderr}")
        return False
    return True

def main():
    print("=" * 50)
    print("QCE Framework Plugin Builder")
    print("=" * 50)
    print()
    
    version = get_qce_version()
    output_dir = "qce-framework-plugin"
    output_zip = f"QCE-Framework-Plugin-v{version}.zip"
    
    print(f"[*] Version: {version}")
    print(f"[*] Output: {output_zip}")
    print()
    
    # Clean
    print("[1/5] Cleaning...")
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    if os.path.exists(output_zip):
        os.remove(output_zip)
    print("[x] Done")
    print()
    
    # Copy plugin
    print("[2/5] Copying plugin files...")
    shutil.copytree("plugins/qq-chat-exporter", f"{output_dir}/qq-chat-exporter")
    print("[x] Done")
    print()
    
    # Install dependencies
    print("[3/5] Installing dependencies...")
    plugin_dir = f"{output_dir}/qq-chat-exporter"
    if not run_command(["npm", "install", "--omit=dev"], cwd=plugin_dir):
        sys.exit(1)
    print("[x] Done")
    print()
    
    # Generate overlay
    print("[4/5] Generating overlay runtime...")
    if not run_command(["node", "tools/create-overlay-runtime.cjs"], cwd=plugin_dir):
        sys.exit(1)
    print("[x] Done")
    print()
    
    # Create README
    readme = f"""QCE Framework Plugin v{version}
{"=" * 40}

此包仅包含 QCE 插件，适用于已安装 NapCat Framework 的用户。

安装步骤:
1. 将 qq-chat-exporter 文件夹复制到 NapCat 插件目录
   Windows: %APPDATA%/LiteLoaderQQNT/plugins/NapCat/plugins/
   
2. 在 NapCat 配置中启用插件 (config/napcat.json):
   {{
     "plugins": {{
       "enable": true,
       "list": [
         {{
           "name": "qq-chat-exporter",
           "enable": true,
           "path": "./plugins/qq-chat-exporter/index.mjs"
         }}
       ]
     }}
   }}

3. 重启 QQNT

4. 访问 http://localhost:40653/qce-v4-tool

注意: 此包不包含 NapCat 本体，需要先安装 NapCat Framework。
详见: https://napneko.github.io/
"""
    with open(f"{output_dir}/README.txt", "w", encoding="utf-8") as f:
        f.write(readme)
    
    # Create ZIP
    print("[5/5] Creating ZIP...")
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
    shutil.rmtree(output_dir)
    
    print("=" * 50)
    print("[x] Build complete!")
    print("=" * 50)

if __name__ == "__main__":
    main()
