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
from plugin_runtime import (
    copy_windows_server_binary,
    stage_plugin_runtime,
    write_find_qq_script,
)

SOURCE_PLUGIN_DIR = "plugins/qq-chat-exporter"
RUNTIME_PLUGIN_ID = "napcat-plugin-qce"

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

def write_napcat_builtin_plugin_config(config_dir):
    """Disable the builtin #napcat reply command by default."""
    builtin_config_dir = os.path.join(config_dir, "plugins", "napcat-plugin-builtin")
    os.makedirs(builtin_config_dir, exist_ok=True)

    builtin_config = {
        "prefix": "#napcat",
        "enableReply": False,
        "description": "这是一个内置插件的配置示例"
    }

    with open(os.path.join(builtin_config_dir, "config.json"), "w", encoding="utf-8") as f:
        json.dump(builtin_config, f, indent=2, ensure_ascii=False)

def rewrite_runtime_plugin_package(plugin_dir):
    """Rewrite release package metadata to the NapCat official plugin ID."""
    package_json = os.path.join(plugin_dir, "package.json")
    with open(package_json, "r", encoding="utf-8") as f:
        package_data = json.load(f)
    package_data["name"] = RUNTIME_PLUGIN_ID
    with open(package_json, "w", encoding="utf-8") as f:
        json.dump(package_data, f, indent=2, ensure_ascii=False)
        f.write("\n")

# Enhanced napiLoader launchers (issue #589): the upstream NapCat.Framework
# loaders only probe a single WOW6432Node uninstall key and abort with
# "provided QQ path is invalid" when it is missing. We replace them with
# launchers that reuse the saved path, run the multi-source find-qq.ps1 probe,
# fall back to the direct registry query and common install paths, and offer a
# manual QQ.exe picker with an actionable error message instead of dying.
NAPILOADER_RESOLVE_LOGIC = '''
:resolve_qq_path
rem Priority 1: Command line argument
if not "%~1"=="" if exist "%~1" (
    set "QQPath=%~1"
    goto :save_and_boot
)

rem Priority 2: Saved path from previous run
if exist "%QQ_PATH_CONFIG%" (
    set /p SavedPath=<"!QQ_PATH_CONFIG!"
    if exist "!SavedPath!" (
        set "QQPath=!SavedPath!"
        echo [Info] Using saved QQ path: !SavedPath!
        goto :napcat_boot
    )
)

rem Priority 3: Multi-source probe (registry, App Paths, protocol handler,
rem shortcuts) via find-qq.ps1 (issue #589)
if exist "%cd%\\find-qq.ps1" (
    for /f "usebackq delims=" %%i in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%cd%\\find-qq.ps1" 2^>nul`) do set "QQPath=%%i"
    if not "!QQPath!"=="" if exist "!QQPath!" goto :save_and_boot
)

rem Priority 3b: Direct registry query (fallback when PowerShell is unavailable)
for /f "tokens=2*" %%a in ('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ" /v "UninstallString" 2^>nul') do (
    set "RetString=%%~b"
    for %%x in ("!RetString!") do set "pathWithoutUninstall=%%~dpx"
    set "QQPath=!pathWithoutUninstall!QQ.exe"
    if exist "!QQPath!" goto :save_and_boot
)

rem Priority 4: Common installation paths
rem Hoist %ProgramFiles(x86)% out of the for-list so the literal `(x86)` does
rem not collide with the surrounding `for ... in (...)` parentheses (#291).
set "PFX86=%ProgramFiles(x86)%"
for %%p in (
    "%ProgramFiles%\\Tencent\\QQNT\\QQ.exe"
    "!PFX86!\\Tencent\\QQNT\\QQ.exe"
    "%LocalAppData%\\Programs\\Tencent\\QQNT\\QQ.exe"
    "C:\\Program Files\\Tencent\\QQNT\\QQ.exe"
    "D:\\Program Files\\Tencent\\QQNT\\QQ.exe"
) do (
    if exist %%p (
        set "QQPath=%%~p"
        goto :save_and_boot
    )
)

:manual_select
echo.
echo ============================================
echo   QQ Installation Not Found
echo ============================================
echo.
echo Could not detect QQ installation automatically.
echo This may happen if you are using a portable/green version of QQ.
echo.
echo If QQ ^(QQNT^) is not installed yet, download it first:
echo   https://im.qq.com/
echo.
echo Options:
echo   [1] Browse for QQ.exe (GUI file picker)
echo   [2] Enter path manually
echo   [3] Exit
echo.
set /p choice="Select option (1/2/3): "

if "%choice%"=="1" goto :gui_select
if "%choice%"=="2" goto :text_input
if "%choice%"=="3" exit /b 1
goto :manual_select

:gui_select
echo.
echo [Info] Opening file picker...
for /f "delims=" %%i in ('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Filter = 'QQ Executable (QQ.exe)|QQ.exe|All Files (*.*)|*.*'; $f.Title = 'Select QQ.exe'; $f.InitialDirectory = 'C:\\Program Files'; if ($f.ShowDialog() -eq 'OK') { $f.FileName } else { '' }"') do set "QQPath=%%i"

if "%QQPath%"=="" (
    echo [Error] No file selected.
    goto :manual_select
)
goto :validate_path

:text_input
echo.
set /p "QQPath=Enter full path to QQ.exe: "

:validate_path
if not exist "!QQPath!" (
    echo [Error] File not found: !QQPath!
    goto :manual_select
)

for %%f in ("!QQPath!") do set "filename=%%~nxf"
if /i not "%filename%"=="QQ.exe" (
    echo [Warning] Selected file is not QQ.exe, continue anyway? (Y/N)
    set /p confirm="Confirm: "
    if /i not "!confirm!"=="Y" goto :manual_select
)

:save_and_boot
if not exist "%cd%\\config" mkdir "%cd%\\config"
echo !QQPath!>"%QQ_PATH_CONFIG%"
echo [Info] QQ path saved to config\\qq_path.txt

:napcat_boot
echo.
echo [Info] Using QQ: "!QQPath!"

set NAPCAT_MAIN_PATH=%NAPCAT_MAIN_PATH:\\=/%
'''

NAPILOADER_HEADER = '''@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set NAPCAT_INJECT_PATH=%cd%\\napiloader.dll
set NAPCAT_LAUNCHER_PATH=%cd%\\napimain.exe
set NAPCAT_MAIN_PATH=%cd%\\nativeLoader.cjs
set QQ_PATH_CONFIG=%cd%\\config\\qq_path.txt
'''

NAPILOADER_BAT = NAPILOADER_HEADER + NAPILOADER_RESOLVE_LOGIC + '''
start "" "%NAPCAT_LAUNCHER_PATH%" "!QQPath!" "%NAPCAT_INJECT_PATH%" "%NAPCAT_MAIN_PATH%"
'''

NAPILOADER_DEBUG_BAT = NAPILOADER_HEADER + '''set NAPCAT_DEBUG_CONSOLE=1
''' + NAPILOADER_RESOLVE_LOGIC + '''
"%NAPCAT_LAUNCHER_PATH%" "!QQPath!" "%NAPCAT_INJECT_PATH%" "%NAPCAT_MAIN_PATH%"

pause
'''

def write_enhanced_napiloaders(output_dir):
    """Replace upstream napiLoader launchers with multi-source QQ discovery."""
    for name, content in (
        ("napiLoader.bat", NAPILOADER_BAT),
        ("napiLoader-debug.bat", NAPILOADER_DEBUG_BAT),
    ):
        with open(os.path.join(output_dir, name), "w", encoding="utf-8", newline="\r\n") as f:
            f.write(content)
    write_find_qq_script(Path(output_dir))

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

    # Replace upstream napiLoader launchers with multi-source QQ discovery
    # and a manual-selection fallback (issue #589).
    print("[3.5/8] Writing enhanced napiLoader launchers...")
    write_enhanced_napiloaders(output_dir)
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
    qce_dest = os.path.join(plugins_dir, RUNTIME_PLUGIN_ID)
    stage_plugin_runtime(
        Path(SOURCE_PLUGIN_DIR),
        Path(qce_dest),
        RUNTIME_PLUGIN_ID,
        qce_version,
    )
    print("[x] Done")
    print()
    print("[INFO] Building Rust server")
    copy_windows_server_binary(Path(output_dir))
    print("[PASS] Rust server built")
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
        "napcat-plugin-builtin": True,
        RUNTIME_PLUGIN_ID: True
    }

    with open(os.path.join(config_dir, "napcat.json"), "w", encoding="utf-8") as f:
        json.dump(napcat_config, f, indent=2, ensure_ascii=False)

    with open(os.path.join(config_dir, "plugins.json"), "w", encoding="utf-8") as f:
        json.dump(plugins_config, f, indent=2, ensure_ascii=False)

    write_napcat_builtin_plugin_config(config_dir)
    print("[x] Done")
    print()
    
    # Copy frontend
    print("[7.6/8] Copying frontend...")
    frontend_out = os.environ.get("QCE_FRONTEND_OUT", "qce-v4-tool/out")
    static_dir = os.path.join(output_dir, "static", "qce")
    
    if os.path.exists(f"{frontend_out}/index.html"):
        shutil.copytree(frontend_out, static_dir)
        print("[x] Done")
    else:
        if os.environ.get("QCE_FRONTEND_OUT"):
            print(f"[!] QCE_FRONTEND_OUT is missing index.html: {frontend_out}")
            sys.exit(1)
        print("[-] Frontend not built, building...")
        os_name = platform.system()
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

## 两种使用方式

### 方式 A：直接运行 `napiLoader.bat`（推荐）

如果你只是想让 QCE 和桌面 QQ 一起工作，直接走这条路就可以。  
**这条路不要求先安装 LiteLoaderQQNT。**

1. 解压 `NapCat-Framework-QCE-v{qce_version}.zip`
2. 如果当前 QQ 正在运行，先完全退出 QQ
3. 在解压后的目录里运行 `napiLoader.bat`
4. 如果 QQ 弹出登录页，按平时的方式登录 QQ
5. 访问 <http://localhost:40653/qce>

### 方式 B：LiteLoaderQQNT 插件方式（只有明确要这样装时才用）

**只有这条路才要求先安装 LiteLoaderQQNT。**

1. 先按 LiteLoaderQQNT 官方文档完成安装：<https://liteloaderqqnt.github.io/>
2. 装好以后，确认 QQ 设置左侧已经出现 LiteLoaderQQNT
3. 再按 LiteLoaderQQNT / NapCat 的插件安装方式去部署这个包

如果你只是普通使用，优先走上面的 `napiLoader.bat` 路线就可以。

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

两种使用方式:

方式 A: 直接运行 napiLoader.bat（推荐）
这条路不要求先安装 LiteLoaderQQNT。
1. 解压 NapCat-Framework-QCE-v{qce_version}.zip
2. 如果当前 QQ 正在运行，先完全退出 QQ
3. 在解压后的目录里运行 napiLoader.bat
4. 如果 QQ 弹出登录页，按平时的方式登录 QQ
5. 访问 http://localhost:40653/qce

方式 B: LiteLoaderQQNT 插件方式（只有明确要这样装时才用）
只有这条路才要求先安装 LiteLoaderQQNT。
1. 先按 LiteLoaderQQNT 官方文档完成安装: https://liteloaderqqnt.github.io/
2. 装好以后，确认 QQ 设置左侧已经出现 LiteLoaderQQNT
3. 再按 LiteLoaderQQNT / NapCat 的插件安装方式去部署这个包

如果你只是普通使用，优先走上面的 napiLoader.bat 路线就可以。

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
