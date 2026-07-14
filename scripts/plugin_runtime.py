"""Helpers for staging the Rust-only NapCat plugin runtime."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import stat
from pathlib import Path


SERVER_DIR = Path("qq-chat-export-server")


def run_command(command: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(command, cwd=cwd)
    if result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(command)}")


def resolve_prebuilt_binary(*env_names: str) -> Path | None:
    for env_name in env_names:
        value = os.environ.get(env_name)
        if not value:
            continue
        binary = Path(value)
        if not binary.is_file():
            raise FileNotFoundError(
                f"{env_name} points to a missing server binary: {binary}"
            )
        return binary
    return None


def ensure_executable(binary: Path) -> None:
    if binary.name.endswith(".exe"):
        return
    binary.chmod(binary.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def stage_plugin_runtime(
    source_plugin_dir: Path,
    destination: Path,
    plugin_id: str,
    version: str | None = None,
) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    shutil.copy2(source_plugin_dir / "index.mjs", destination / "index.mjs")
    shutil.copy2(source_plugin_dir / "icon.png", destination / "icon.png")
    shutil.copytree(source_plugin_dir / "runtime", destination / "runtime")

    package_data = json.loads(
        (source_plugin_dir / "package.json").read_text(encoding="utf-8")
    )
    package_data["name"] = plugin_id
    if version:
        package_data["version"] = version
    package_data["dependencies"] = {}
    package_data.pop("devDependencies", None)
    package_data.pop("scripts", None)
    (destination / "package.json").write_text(
        json.dumps(package_data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

def build_server_binary(target: str | None = None) -> Path:
    command = ["cargo", "build", "--release"]
    if target:
        command.extend(["--target", target])
    run_command(command, SERVER_DIR)

    executable = (
        "qce-server.exe"
        if (target and "windows" in target) or (target is None and platform.system() == "Windows")
        else "qce-server"
    )
    target_dir = SERVER_DIR / "target"
    if target:
        target_dir /= target
    binary = target_dir / "release" / executable
    if not binary.exists():
        raise FileNotFoundError(f"Rust server binary not found: {binary}")
    return binary


def copy_native_server_binary(destination: Path) -> Path:
    if platform.system() == "Windows":
        binary = resolve_prebuilt_binary("QCE_SERVER_WINDOWS_X64", "QCE_SERVER_BINARY")
        target_name = "qce-server.exe"
    else:
        binary = resolve_prebuilt_binary("QCE_SERVER_LINUX_X64", "QCE_SERVER_BINARY")
        target_name = "qce-server"

    if binary is None:
        binary = build_server_binary()
        target_name = binary.name

    destination.mkdir(parents=True, exist_ok=True)
    target = destination / target_name
    shutil.copy2(binary, target)
    ensure_executable(target)
    return target


def copy_windows_server_binary(destination: Path) -> Path:
    binary = resolve_prebuilt_binary("QCE_SERVER_WINDOWS_X64")
    if binary is None and platform.system() == "Windows":
        binary = build_server_binary()
    elif binary is None:
        binary = build_server_binary("x86_64-pc-windows-gnu")
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "qce-server.exe"
    shutil.copy2(binary, target)
    return target


def copy_store_server_binaries(destination: Path) -> None:
    linux_override = resolve_prebuilt_binary("QCE_SERVER_LINUX_X64")
    windows_override = resolve_prebuilt_binary("QCE_SERVER_WINDOWS_X64")

    linux_binary = (
        linux_override
        if linux_override
        else build_server_binary()
    )
    windows_binary = (
        windows_override
        if windows_override
        else build_server_binary("x86_64-pc-windows-gnu")
    )

    linux_dir = destination / "bin" / "linux-x64"
    windows_dir = destination / "bin" / "windows-x64"
    linux_dir.mkdir(parents=True)
    windows_dir.mkdir(parents=True)
    linux_target = linux_dir / "qce-server"
    shutil.copy2(linux_binary, linux_target)
    ensure_executable(linux_target)
    shutil.copy2(windows_binary, windows_dir / "qce-server.exe")


# find-qq.ps1: multi-source QQNT discovery for Windows launchers (issue #589).
# Probes uninstall registry entries (64-bit / 32-bit / per-user), App Paths,
# the tencent:// protocol handler and QQ shortcuts, then prints the first
# QQ.exe that actually exists on disk.
FIND_QQ_PS1 = r"""$ErrorActionPreference = 'SilentlyContinue'

$candidates = New-Object System.Collections.Generic.List[string]

function Add-Candidate([string]$path) {
    if ($path) { $script:candidates.Add($path.Trim('"').Trim()) }
}

# 1) Uninstall registry entries (64-bit, 32-bit and per-user installs)
foreach ($key in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ'
)) {
    $props = Get-ItemProperty -LiteralPath $key
    if (-not $props) { continue }
    if ($props.DisplayIcon) { Add-Candidate ($props.DisplayIcon -replace ',\d+$', '') }
    if ($props.UninstallString) {
        $dir = Split-Path -Parent ($props.UninstallString.Trim('"'))
        if ($dir) { Add-Candidate (Join-Path $dir 'QQ.exe') }
    }
    if ($props.InstallLocation) { Add-Candidate (Join-Path $props.InstallLocation 'QQ.exe') }
}

# 2) App Paths
foreach ($key in @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\QQ.exe',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\QQ.exe'
)) {
    Add-Candidate (Get-ItemProperty -LiteralPath $key).'(default)'
}

# 3) tencent:// protocol handler: points inside versions\<ver>\resources\app,
#    so walk up the directory tree probing for QQ.exe at each level.
$proto = (Get-ItemProperty -LiteralPath 'Registry::HKEY_CLASSES_ROOT\Tencent\shell\open\command').'(default)'
if ($proto -match '"([^"]+)"') {
    $dir = Split-Path -Parent $Matches[1]
    for ($i = 0; $i -lt 6 -and $dir; $i++) {
        Add-Candidate (Join-Path $dir 'QQ.exe')
        $dir = Split-Path -Parent $dir
    }
}

# 4) Start menu and desktop shortcuts
$shell = New-Object -ComObject WScript.Shell
foreach ($root in @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
    "$env:USERPROFILE\Desktop",
    "$env:PUBLIC\Desktop"
)) {
    Get-ChildItem -LiteralPath $root -Filter '*QQ*.lnk' -Recurse -Depth 2 |
        ForEach-Object { Add-Candidate $shell.CreateShortcut($_.FullName).TargetPath }
}

# 5) Common installation directories
foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LocalAppData\Programs", 'D:\Program Files')) {
    if ($base) { Add-Candidate (Join-Path $base 'Tencent\QQNT\QQ.exe') }
}

foreach ($candidate in $candidates) {
    if ((Split-Path -Leaf $candidate) -ieq 'QQ.exe' -and (Test-Path -LiteralPath $candidate)) {
        Write-Output $candidate
        exit 0
    }
}
"""


def write_find_qq_script(destination: Path) -> Path:
    """Write find-qq.ps1 next to the Windows launchers."""
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "find-qq.ps1"
    with open(target, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(FIND_QQ_PS1)
    return target
