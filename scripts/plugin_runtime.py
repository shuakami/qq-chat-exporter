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
