#!/usr/bin/env python3
"""
NapCat 插件商店发行包构建脚本

输出: napcat-plugin-qce.zip

zip 内容（位于 zip 根目录，对齐 napcat-plugin-template 的发行规范）:
  - index.mjs                     插件入口
  - package.json                  含 name=napcat-plugin-qce / icon / napcat 字段
  - icon.png                      高清圆形头像
  - runtime/                      原生 ESM 薄桥接（启动 Rust 服务）
  - bin/                          Linux / Windows qce-server
  - webui/                        前端静态产物（来自 qce/out）

NapCat 通过 plugins.v4.json 拉取此 zip 后，会解压到
  <NapCat>/plugins/napcat-plugin-qce/
其中 package.json.icon 指向 ./icon.png，被 NapCat WebUI 用作插件商店内的展示头像。
"""

import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from plugin_runtime import copy_store_server_binaries, stage_plugin_runtime


PLUGIN_ID = "napcat-plugin-qce"
PLUGIN_DISPLAY_NAME = "QQ 聊天记录导出"
SOURCE_PLUGIN_DIR = Path("plugins/qq-chat-exporter")
FRONTEND_DIR = Path("qce-v4-tool")
FRONTEND_OUT_DIR = Path(os.environ.get("QCE_FRONTEND_OUT", FRONTEND_DIR / "out"))


def get_qce_version() -> str:
    if os.environ.get("QCE_VERSION"):
        return os.environ["QCE_VERSION"].lstrip("v")
    pkg_path = SOURCE_PLUGIN_DIR / "package.json"
    return json.loads(pkg_path.read_text(encoding="utf-8")).get("version", "unknown")


def run_command(cmd, cwd=None) -> bool:
    print(f"[RUN] {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    result = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str))
    return result.returncode == 0


def ensure_frontend_built() -> None:
    if (FRONTEND_OUT_DIR / "index.html").exists():
        print(f"[PASS] Frontend found at {FRONTEND_OUT_DIR}")
        return

    if os.environ.get("QCE_FRONTEND_OUT"):
        sys.exit(f"[ERROR] QCE_FRONTEND_OUT is missing index.html: {FRONTEND_OUT_DIR}")

    print("[INFO] Frontend is missing; starting build")
    pnpm_cmd = "pnpm.cmd" if platform.system() == "Windows" else "pnpm"
    if not run_command([pnpm_cmd, "install"], cwd=str(FRONTEND_DIR)):
        sys.exit("[ERROR] Frontend dependency installation failed")
    if not run_command([pnpm_cmd, "run", "build"], cwd=str(FRONTEND_DIR)):
        sys.exit("[ERROR] Frontend build failed")
    if not (FRONTEND_OUT_DIR / "index.html").exists():
        sys.exit("[ERROR] Frontend build did not produce out/index.html")


def write_plugin_package_json(staging_plugin_dir: Path, qce_version: str) -> None:
    """生成插件商店专用的 package.json。

    保留 dependencies / engines / main / type 等运行时必要字段，
    重写 name -> napcat-plugin-qce，注入 plugin / icon / napcat / homepage / repository。
    剥离 devDependencies / scripts / keywords，避免 zip 内出现仅开发期需要的字段。
    """
    src_pkg = json.loads((SOURCE_PLUGIN_DIR / "package.json").read_text(encoding="utf-8"))

    plugin_pkg = {
        "name": PLUGIN_ID,
        "plugin": PLUGIN_DISPLAY_NAME,
        "version": qce_version,
        "description": src_pkg.get("description", ""),
        "main": src_pkg.get("main", "index.mjs"),
        "type": src_pkg.get("type", "module"),
        "icon": "icon.png",
        "homepage": "https://github.com/shuakami/qq-chat-exporter",
        "repository": {
            "type": "git",
            "url": "https://github.com/shuakami/qq-chat-exporter.git"
        },
        "author": src_pkg.get("author", "shuakami"),
        "napcat": {
            "tags": ["工具"],
            "minVersion": "4.14.0",
            "homepage": "https://github.com/shuakami/qq-chat-exporter"
        },
        "dependencies": src_pkg.get("dependencies", {}),
        "engines": src_pkg.get("engines", {"node": ">=18.0.0"})
    }

    (staging_plugin_dir / "package.json").write_text(
        json.dumps(plugin_pkg, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )


def stage_plugin_files(staging_plugin_dir: Path) -> None:
    """把源插件目录里需要进入 zip 的文件拷到 staging。"""
    stage_plugin_runtime(
        SOURCE_PLUGIN_DIR,
        staging_plugin_dir,
        PLUGIN_ID,
        get_qce_version(),
    )


def stage_frontend(staging_plugin_dir: Path) -> None:
    webui_dest = staging_plugin_dir / "webui"
    if webui_dest.exists():
        shutil.rmtree(webui_dest)
    print(f"[INFO] Copying frontend: {FRONTEND_OUT_DIR} -> {webui_dest}")
    shutil.copytree(FRONTEND_OUT_DIR, webui_dest)


def create_zip(staging_plugin_dir: Path, output_zip: Path) -> None:
    if output_zip.exists():
        output_zip.unlink()
    print(f"[INFO] Creating archive: {output_zip}")
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, _dirs, files in os.walk(staging_plugin_dir):
            for f in files:
                fp = Path(root) / f
                arcname = fp.relative_to(staging_plugin_dir).as_posix()
                zf.write(fp, arcname)
    size_mb = output_zip.stat().st_size / 1024 / 1024
    print(f"[PASS] Archive created: {output_zip} ({size_mb:.2f} MB)")


def main() -> None:
    print("=" * 60)
    print("NapCat Plugin Store Package Builder")
    print("=" * 60)

    if not SOURCE_PLUGIN_DIR.exists():
        sys.exit(f"[ERROR] Source plugin directory is missing: {SOURCE_PLUGIN_DIR}")

    qce_version = get_qce_version()
    output_zip = Path(f"{PLUGIN_ID}.zip")
    staging_root = Path("napcat-plugin-staging")
    staging_plugin_dir = staging_root / PLUGIN_ID

    print(f"[INFO] QCE version: {qce_version}")
    print(f"[INFO] Plugin ID: {PLUGIN_ID}")
    print(f"[INFO] Output archive: {output_zip}")
    print()

    if staging_root.exists():
        shutil.rmtree(staging_root)

    # 1) 前端必须先构建好
    ensure_frontend_built()

    # 2) 复制 Rust-only 运行时到 staging
    stage_plugin_files(staging_plugin_dir)

    # 3) 写入插件商店专用 package.json
    write_plugin_package_json(staging_plugin_dir, qce_version)

    # 4) 构建并内置 Linux / Windows Rust 服务
    copy_store_server_binaries(staging_plugin_dir)

    # 5) 拷贝前端
    stage_frontend(staging_plugin_dir)

    # 6) 打 zip
    create_zip(staging_plugin_dir, output_zip)

    print()
    print("=" * 60)
    print("[PASS] Build complete")
    print("=" * 60)
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
