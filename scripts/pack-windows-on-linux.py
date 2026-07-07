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

RUST_EXE = os.path.join(ROOT, "rust-server", "target", "x86_64-pc-windows-gnu", "release", "qce-server.exe")

spec.loader.exec_module(qp)

qp.get_platform_info = lambda: ("Windows", "x64", ".zip")

_orig_run_command = qp.run_command

def run_command(cmd, cwd=None, shell=False):
    if isinstance(cmd, list) and cmd:
        mapping = {"npm.cmd": "npm", "node.exe": "node", "pnpm.cmd": "pnpm"}
        cmd = [mapping.get(cmd[0], cmd[0])] + cmd[1:]
    return _orig_run_command(cmd, cwd=cwd, shell=shell)

qp.run_command = run_command

_orig_create_archive = qp.create_archive

def create_archive(source_dir, output_file, format_type):
    if not os.path.exists(RUST_EXE):
        print(f"[!] Rust binary missing: {RUST_EXE}")
        sys.exit(1)
    dest = os.path.join(source_dir, "qce-server.exe")
    shutil.copy2(RUST_EXE, dest)
    print(f"[x] Added Rust server binary: {dest}")
    return _orig_create_archive(source_dir, output_file, format_type)

qp.create_archive = create_archive

qp.main()
