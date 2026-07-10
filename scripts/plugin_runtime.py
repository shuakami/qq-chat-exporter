"""Helpers for staging the Rust-only NapCat plugin runtime."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from pathlib import Path


SERVER_DIR = Path("qq-chat-export-server")


def run_command(command: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(command, cwd=cwd)
    if result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(command)}")


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

    executable = "qce-server.exe" if target and "windows" in target else "qce-server"
    target_dir = SERVER_DIR / "target"
    if target:
        target_dir /= target
    binary = target_dir / "release" / executable
    if not binary.exists():
        raise FileNotFoundError(f"Rust server binary not found: {binary}")
    return binary


def copy_native_server_binary(destination: Path) -> Path:
    binary = build_server_binary()
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / binary.name
    shutil.copy2(binary, target)
    return target


def copy_windows_server_binary(destination: Path) -> Path:
    if platform.system() == "Windows":
        binary = build_server_binary()
    else:
        binary = build_server_binary("x86_64-pc-windows-gnu")
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / "qce-server.exe"
    shutil.copy2(binary, target)
    return target


def copy_store_server_binaries(destination: Path) -> None:
    linux_override = os.environ.get("QCE_SERVER_LINUX_X64")
    windows_override = os.environ.get("QCE_SERVER_WINDOWS_X64")

    linux_binary = (
        Path(linux_override)
        if linux_override
        else build_server_binary()
    )
    windows_binary = (
        Path(windows_override)
        if windows_override
        else build_server_binary("x86_64-pc-windows-gnu")
    )

    linux_dir = destination / "bin" / "linux-x64"
    windows_dir = destination / "bin" / "windows-x64"
    linux_dir.mkdir(parents=True)
    windows_dir.mkdir(parents=True)
    shutil.copy2(linux_binary, linux_dir / "qce-server")
    shutil.copy2(windows_binary, windows_dir / "qce-server.exe")
