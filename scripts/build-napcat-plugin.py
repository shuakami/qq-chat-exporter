#!/usr/bin/env python3
"""
NapCat 插件商店发行包构建脚本

输出: napcat-plugin-qce.zip

zip 内容（位于 zip 根目录，对齐 napcat-plugin-template 的发行规范）:
  - index.mjs                     插件入口
  - package.json                  含 name=napcat-plugin-qce / icon / napcat 字段
  - icon.png                      高清圆形头像
  - lib/                          TypeScript 源码（运行时由 tsx 直接加载）
  - node_modules/                 仅生产依赖 + NapCatQQ overlay runtime
  - webui/                        前端静态产物（来自 qce-v4-tool/out）

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


PLUGIN_ID = "napcat-plugin-qce"
PLUGIN_DISPLAY_NAME = "QQ 聊天记录导出"
SOURCE_PLUGIN_DIR = Path("plugins/qq-chat-exporter")
FRONTEND_DIR = Path("qce-v4-tool")
FRONTEND_OUT_DIR = FRONTEND_DIR / "out"


def get_qce_version() -> str:
    if os.environ.get("QCE_VERSION"):
        return os.environ["QCE_VERSION"].lstrip("v")
    pkg_path = SOURCE_PLUGIN_DIR / "package.json"
    return json.loads(pkg_path.read_text(encoding="utf-8")).get("version", "unknown")


def run_command(cmd, cwd=None) -> bool:
    print(f"[>] {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    result = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str))
    return result.returncode == 0


def ensure_frontend_built() -> None:
    if (FRONTEND_OUT_DIR / "index.html").exists():
        print(f"[x] Frontend already built at {FRONTEND_OUT_DIR}")
        return

    print("[-] Frontend not built, building...")
    pnpm_cmd = "pnpm.cmd" if platform.system() == "Windows" else "pnpm"
    if not run_command([pnpm_cmd, "install"], cwd=str(FRONTEND_DIR)):
        sys.exit("[!] Frontend pnpm install failed")
    if not run_command([pnpm_cmd, "run", "build"], cwd=str(FRONTEND_DIR)):
        sys.exit("[!] Frontend build failed")
    if not (FRONTEND_OUT_DIR / "index.html").exists():
        sys.exit("[!] Frontend build did not produce out/index.html")


def ensure_overlay_runtime() -> None:
    overlay_dir = SOURCE_PLUGIN_DIR / "node_modules" / "NapCatQQ"
    overlay_pkg = overlay_dir / "package.json"
    if overlay_pkg.exists():
        print(f"[x] NapCatQQ overlay already present at {overlay_dir}")
        return

    print("[-] NapCatQQ overlay missing, generating...")
    node_cmd = "node.exe" if platform.system() == "Windows" else "node"
    if not run_command([node_cmd, "tools/create-overlay-runtime.cjs"], cwd=str(SOURCE_PLUGIN_DIR)):
        sys.exit("[!] Overlay runtime generation failed")


def install_prod_deps(staging_plugin_dir: Path) -> None:
    print("[-] Installing production dependencies into staging dir...")
    npm_cmd = "npm.cmd" if platform.system() == "Windows" else "npm"
    if not run_command([npm_cmd, "install", "--omit=dev", "--no-audit", "--no-fund"], cwd=str(staging_plugin_dir)):
        sys.exit("[!] npm install --omit=dev failed")


def copy_overlay_runtime(staging_plugin_dir: Path) -> None:
    src = SOURCE_PLUGIN_DIR / "node_modules" / "NapCatQQ"
    dest = staging_plugin_dir / "node_modules" / "NapCatQQ"
    if dest.exists():
        shutil.rmtree(dest)
    print(f"[-] Copying NapCatQQ overlay: {src} -> {dest}")
    shutil.copytree(src, dest)


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
    if staging_plugin_dir.exists():
        shutil.rmtree(staging_plugin_dir)
    staging_plugin_dir.mkdir(parents=True)

    # 入口
    shutil.copy2(SOURCE_PLUGIN_DIR / "index.mjs", staging_plugin_dir / "index.mjs")

    # package-lock.json 用于 npm install --omit=dev 的可重现安装
    pkg_lock = SOURCE_PLUGIN_DIR / "package-lock.json"
    if pkg_lock.exists():
        shutil.copy2(pkg_lock, staging_plugin_dir / "package-lock.json")

    # icon
    icon_src = SOURCE_PLUGIN_DIR / "icon.png"
    if not icon_src.exists():
        sys.exit(f"[!] icon.png missing at {icon_src}")
    shutil.copy2(icon_src, staging_plugin_dir / "icon.png")

    # lib/ 全量拷贝（tsx 运行时直接加载 .ts）
    shutil.copytree(SOURCE_PLUGIN_DIR / "lib", staging_plugin_dir / "lib")


def stage_frontend(staging_plugin_dir: Path) -> None:
    webui_dest = staging_plugin_dir / "webui"
    if webui_dest.exists():
        shutil.rmtree(webui_dest)
    print(f"[-] Copying frontend: {FRONTEND_OUT_DIR} -> {webui_dest}")
    shutil.copytree(FRONTEND_OUT_DIR, webui_dest)


def trim_node_modules(staging_plugin_dir: Path) -> None:
    """裁剪 node_modules 中不必要的体积。"""
    node_modules = staging_plugin_dir / "node_modules"
    if not node_modules.exists():
        return

    # 删掉 *.d.ts / @types / 测试目录 / 文档之类
    junk_globs = [
        "*.md", "*.markdown", "LICENSE*", "license*", "CHANGELOG*", "changelog*",
        ".github", ".vscode", "test", "tests", "__tests__", "example", "examples",
        "docs", "doc", "*.map"
    ]
    types_dir = node_modules / "@types"
    if types_dir.exists():
        shutil.rmtree(types_dir)

    for root, dirs, files in os.walk(node_modules):
        # 删除常见无用目录
        for d in list(dirs):
            if d in {".github", ".vscode", "test", "tests", "__tests__", "example", "examples", "docs", "doc"}:
                shutil.rmtree(Path(root) / d, ignore_errors=True)
                dirs.remove(d)
        for f in files:
            lower = f.lower()
            if (
                lower.endswith(".md") or lower.endswith(".markdown") or
                lower.startswith("license") or lower.startswith("changelog") or
                lower.endswith(".map")
            ):
                try:
                    (Path(root) / f).unlink()
                except OSError:
                    pass


def create_zip(staging_plugin_dir: Path, output_zip: Path) -> None:
    if output_zip.exists():
        output_zip.unlink()
    print(f"[-] Creating zip: {output_zip}")
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, _dirs, files in os.walk(staging_plugin_dir):
            for f in files:
                fp = Path(root) / f
                arcname = fp.relative_to(staging_plugin_dir).as_posix()
                zf.write(fp, arcname)
    size_mb = output_zip.stat().st_size / 1024 / 1024
    print(f"[x] Zip created: {output_zip} ({size_mb:.2f} MB)")


def main() -> None:
    print("=" * 60)
    print("NapCat Plugin Store Package Builder")
    print("=" * 60)

    if not SOURCE_PLUGIN_DIR.exists():
        sys.exit(f"[!] Source plugin dir missing: {SOURCE_PLUGIN_DIR}")

    qce_version = get_qce_version()
    output_zip = Path(f"{PLUGIN_ID}.zip")
    staging_root = Path("napcat-plugin-staging")
    staging_plugin_dir = staging_root / PLUGIN_ID

    print(f"[*] QCE Version: {qce_version}")
    print(f"[*] Plugin ID:   {PLUGIN_ID}")
    print(f"[*] Output zip:  {output_zip}")
    print()

    # 清理
    if staging_root.exists():
        shutil.rmtree(staging_root)

    # 1) 前端必须先构建好
    ensure_frontend_built()

    # 2) NapCatQQ overlay runtime 必须存在
    ensure_overlay_runtime()

    # 3) 复制源文件到 staging
    stage_plugin_files(staging_plugin_dir)

    # 4) 写入插件商店专用 package.json
    write_plugin_package_json(staging_plugin_dir, qce_version)

    # 5) 安装生产依赖（基于刚写入的 package.json）
    install_prod_deps(staging_plugin_dir)

    # 6) 把 NapCatQQ overlay runtime 复制到 staging 的 node_modules
    copy_overlay_runtime(staging_plugin_dir)

    # 7) 拷贝前端
    stage_frontend(staging_plugin_dir)

    # 8) 裁剪 node_modules 体积
    trim_node_modules(staging_plugin_dir)

    # 9) 打 zip
    create_zip(staging_plugin_dir, output_zip)

    print()
    print("=" * 60)
    print("[x] Build complete!")
    print("=" * 60)
    print(f"Output: {output_zip}")


if __name__ == "__main__":
    main()
