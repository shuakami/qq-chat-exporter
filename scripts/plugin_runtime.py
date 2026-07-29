"""Helpers for staging the Rust-only NapCat plugin runtime."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import stat
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SERVER_DIR = Path("qq-chat-export-server")

NAPCAT_LATEST_API = "https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest"


def _rate_limit_hint(headers) -> str:
    """Say when the GitHub quota lifts and how to get past it meanwhile."""
    reset = (headers.get("X-RateLimit-Reset") or "").strip()
    until = f" until {time.strftime('%H:%M:%S UTC', time.gmtime(int(reset)))}" if reset.isdigit() else ""
    return (
        f"[!] GitHub API rate limited{until}. Re-run the failed jobs once it lifts\n"
        "[!] (no new tag needed), or set GITHUB_TOKEN for the 1000/hour quota,\n"
        "[!] or pin NAPCAT_VERSION=vX.Y.Z."
    )


def get_napcat_latest_version(progress: str = "[*]") -> str:
    """Resolve which NapCat release to bundle.

    NAPCAT_VERSION wins when set, so one CI lookup can feed every packaging job
    and all platforms in a release are guaranteed to bundle the same NapCat.

    There is deliberately no hardcoded fallback. A stale NapCat still builds,
    still passes every packaging check and still ships -- but cannot log in at
    all: v6.1.9's macOS package fell back to NapCat v4.8.119 this way after the
    lookup hit the 60/hour unauthenticated rate limit, and QQ's native bridge
    then failed with `NodeIQQNTWrapperSession.create is not a function` before a
    QR code could ever be generated. Failing the build is the cheaper outcome:
    it happens in seconds, before any artifact exists.
    """
    print(f"{progress} Getting NapCat latest version...")

    pinned = os.environ.get("NAPCAT_VERSION", "").strip()
    if pinned:
        print(f"[x] Using NAPCAT_VERSION from environment: {pinned}")
        return pinned

    headers = {"Accept": "application/vnd.github+json", "User-Agent": "qce-packaging"}
    # GITHUB_TOKEN is injected per-run by Actions; TEMP_GITHUB_PAT lets a local
    # build borrow the same authenticated quota without inventing a new name.
    token = (os.environ.get("GITHUB_TOKEN") or os.environ.get("TEMP_GITHUB_PAT") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    attempts = 4
    for attempt in range(1, attempts + 1):
        try:
            with urlopen(Request(NAPCAT_LATEST_API, headers=headers), timeout=30) as response:
                version = json.loads(response.read())["tag_name"]
            if not version:
                raise ValueError("empty tag_name")
            print(f"[x] Detected NapCat version: {version}")
            return version
        except HTTPError as error:
            # A 4xx will not change on a retry. Rate limiting in particular
            # resets hourly, so report when it lifts rather than retry blindly.
            if error.code < 500:
                if error.code in (403, 429):
                    print(_rate_limit_hint(error.headers))
                raise SystemExit(f"NapCat version lookup failed: HTTP {error.code}")
            reason = f"HTTP {error.code}"
        except (URLError, TimeoutError, ValueError, KeyError) as error:
            reason = str(error) or error.__class__.__name__

        if attempt < attempts:
            delay = 2**attempt
            print(f"[!] Attempt {attempt}/{attempts} failed ({reason}); retrying in {delay}s...")
            time.sleep(delay)

    raise SystemExit(f"NapCat version lookup failed after {attempts} attempts: {reason}")


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
