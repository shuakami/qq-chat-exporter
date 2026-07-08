#!/usr/bin/env python3
"""Build the Windows x64 test package from a Linux host.

Wraps scripts/quick-pack.py: forces the Windows platform profile, maps
Windows-only executable names (npm.cmd / node.exe / pnpm.cmd) to their
POSIX equivalents, and drops the Rust qce-server.exe into the package
root before archiving.
"""

import importlib.util
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

spec = importlib.util.spec_from_file_location("quick_pack", os.path.join(ROOT, "scripts", "quick-pack.py"))
qp = importlib.util.module_from_spec(spec)
qp.__dict__["__name__"] = "quick_pack"
sys.modules["quick_pack"] = qp

RUST_EXE = os.path.join(ROOT, "qq-chat-export-server", "target", "x86_64-pc-windows-gnu", "release", "qce-server.exe")

spec.loader.exec_module(qp)

qp.get_platform_info = lambda: ("Windows", "x64", ".zip")

# GitHub API 可能因速率限制拿不到最新版本，兜底到 v4.18.8（最新稳定版）。
_orig_get_napcat_latest_version = qp.get_napcat_latest_version
def get_napcat_latest_version():
    import urllib.request, json as _json
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest",
            headers={"Accept": "application/vnd.github+json"},
        )
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("TEMP_GITHUB_PAT")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(req) as resp:
            version = _json.loads(resp.read())["tag_name"]
            print(f"[x] Detected NapCat version: {version}")
            return version
    except Exception as e:
        print(f"[!] Failed to get latest version: {e}")
        print("[!] Using fallback version v4.18.8")
        return "v4.18.8"
qp.get_napcat_latest_version = get_napcat_latest_version

_orig_run_command = qp.run_command

def run_command(cmd, cwd=None, shell=False):
    if isinstance(cmd, list) and cmd:
        mapping = {"npm.cmd": "npm", "node.exe": "node", "pnpm.cmd": "pnpm"}
        cmd = [mapping.get(cmd[0], cmd[0])] + cmd[1:]
    return _orig_run_command(cmd, cwd=cwd, shell=shell)

qp.run_command = run_command

# 用交叉编译产物替代本机 cargo build（quick-pack 默认按宿主平台构建）。
def build_rust_server(pack_dir):
    if not os.path.exists(RUST_EXE):
        print(f"[!] Rust binary missing: {RUST_EXE}")
        print("[!] Run: cd qq-chat-export-server && cargo build --release --target x86_64-pc-windows-gnu")
        sys.exit(1)
    dest = os.path.join(pack_dir, "qce-server.exe")
    shutil.copy2(RUST_EXE, dest)
    print(f"[x] Added Rust server binary: {dest}")

qp.build_rust_server = build_rust_server

qp.main()
