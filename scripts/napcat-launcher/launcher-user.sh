#!/bin/bash
# NapCat + QCE launcher (Linux / macOS).
#
# This script wires up the bits NapCat assumes a Windows installer has
# already taken care of.
#
# Linux flow (issue #433):
#   We launch the real QQ Electron binary with libnapcat_launcher.so
#   LD_PRELOAD'ed. The shim hooks open/openat/fopen and rewrites QQ's
#   package.json `main` to point at loadNapCat.js, which imports napcat.mjs
#   out of this directory. wrapper.node thus runs inside the Electron
#   embedder it was built for instead of plain Node.js, where it would
#   segfault on login (`std::vector<std::string>::_M_realloc_insert` inside
#   wrapper.node, observed on Fedora 44 / Debian 13 / NixOS / Arch /
#   Ubuntu 24.04).
#
#   Other Linux-only bits:
#     - qq_magic.so       supplies the qq_magic_napi_register symbol Linux
#                         QQ does not export.
#     - libgnutls.so.30   preloaded when QQ ships libbugly.so, which is
#                         missing the NEEDED entry for it.
#     - NAPCAT_DISABLE_MULTI_PROCESS=1 by default — NapCat's master/worker
#                         mode forks via process.execPath, which under
#                         Electron means spawning headless QQ child
#                         processes and is brittle on most servers.
#
# Legacy launch mode (issue #469):
#   The Electron flow above drives the real QQ client, so QCE occupies the
#   same PC-login slot as the desktop QQ and the two cannot stay online at
#   once. Passing --legacy (or exporting QCE_LINUX_LEGACY_LAUNCH=1) restores
#   the pre-v5.5.64 behaviour: NapCat runs as a standalone Node.js process
#   via napcat-bootstrap.mjs (the same path macOS uses), which coexists with
#   the desktop QQ client. The trade-off is that some distros segfault on
#   login under this path (issue #433).
#
# macOS flow (unchanged):
#   We run `node napcat-bootstrap.mjs`, which overrides process.execPath to
#   the QQ binary and then imports napcat.mjs. The Electron-binary approach
#   is Linux-specific because xvfb/headless concerns and QQ's macOS .app
#   bundle layout differ.

set -u

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

QCE_LOG_DIR="${QCE_LOG_DIR:-$SCRIPT_DIR/logs}"
QCE_LOG_FILE="${QCE_LOG_FILE:-$QCE_LOG_DIR/qce-runtime.log}"
export QCE_LOG_DIR QCE_LOG_FILE
export QCE_STDIO_CAPTURED=1
mkdir -p "$QCE_LOG_DIR"
if command -v tee >/dev/null 2>&1; then
    exec > >(tee -a "$QCE_LOG_FILE") 2>&1
else
    exec >> "$QCE_LOG_FILE" 2>&1
fi
echo "[QCE] launcher started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- 0. Launch-mode selection ----------------------------------------------
#
# Linux only: opt back into the standalone Node.js launch (see "Legacy launch
# mode" above) via --legacy or QCE_LINUX_LEGACY_LAUNCH=1 (issue #469).
QCE_LEGACY_LAUNCH="${QCE_LINUX_LEGACY_LAUNCH:-0}"
for arg in "$@"; do
    case "$arg" in
        --legacy) QCE_LEGACY_LAUNCH=1 ;;
    esac
done

# --- 1. Locate QQ -----------------------------------------------------------

QQ_PATH_CANDIDATES=(
    "/opt/QQ/qq"
    "/opt/linuxqq/qq"
    "/usr/share/QQ/qq"
    "/usr/share/linuxqq/qq"
    "/snap/qq/current/usr/share/QQ/qq"
    "/var/lib/flatpak/app/com.qq.QQ/current/active/files/QQ/qq"
    "/Applications/QQ.app/Contents/MacOS/QQ"
    "$HOME/Applications/QQ.app/Contents/MacOS/QQ"
)

if [ -z "${NAPCAT_QQ_PATH:-}" ]; then
    for cand in "${QQ_PATH_CANDIDATES[@]}"; do
        if [ -x "$cand" ]; then
            # readlink -f resolves /usr/bin/qq -> /opt/QQ/qq, otherwise
            # NapCat would try to read /usr/bin/resources/app/package.json.
            NAPCAT_QQ_PATH=$(readlink -f "$cand" 2>/dev/null || echo "$cand")
            export NAPCAT_QQ_PATH
            break
        fi
    done
fi

if [ -z "${NAPCAT_QQ_PATH:-}" ]; then
    echo "[Error] Could not auto-detect a QQ install."
    echo "        Install QQ from https://im.qq.com/ and re-run, or set:"
    echo "          export NAPCAT_QQ_PATH=/path/to/qq"
    exit 1
fi

if [ ! -x "$NAPCAT_QQ_PATH" ]; then
    echo "[Error] NAPCAT_QQ_PATH ('$NAPCAT_QQ_PATH') is not executable."
    exit 1
fi

QQ_DIR=$(dirname "$NAPCAT_QQ_PATH")
QQ_PKG_JSON="$QQ_DIR/resources/app/package.json"
if [ ! -f "$QQ_PKG_JSON" ]; then
    echo "[Warning] $QQ_PKG_JSON not found."
    echo "          NapCat may fail to read the QQ version. Make sure"
    echo "          NAPCAT_QQ_PATH points at the real QQ binary, not a"
    echo "          symlink to it."
fi

echo "[Info] QQ Path: $NAPCAT_QQ_PATH"

# --- 2. Linux-specific runtime fixes (Electron + LD_PRELOAD) ---------------

if [[ "${OSTYPE:-}" == linux* ]] && [ "$QCE_LEGACY_LAUNCH" != "1" ]; then
    # 2a. Build qq_magic.so if missing — NapCat's native modules dlopen and
    # immediately try to resolve qq_magic_napi_register, which is *not*
    # exported by Linux QQ. The stub forwards to napi_module_register at
    # runtime.
    QQ_MAGIC_SO="$SCRIPT_DIR/qq_magic.so"
    QQ_MAGIC_CPP="$SCRIPT_DIR/qq_magic.cpp"
    if [ ! -f "$QQ_MAGIC_SO" ]; then
        echo "[Info] qq_magic.so missing, attempting in-place compile..."
        if [ ! -f "$QQ_MAGIC_CPP" ]; then
            cat > "$QQ_MAGIC_CPP" <<'__QQMAGIC__'
// In-place fallback emitted by launcher-user.sh.
#include <dlfcn.h>
extern "C" void qq_magic_napi_register(void *m) {
    typedef void (*reg_fn)(void *);
    static reg_fn fn = (reg_fn) dlsym(RTLD_DEFAULT, "napi_module_register");
    if (fn) fn(m);
}
__QQMAGIC__
        fi
        if command -v g++ >/dev/null 2>&1; then
            if g++ -shared -fPIC -O2 -o "$QQ_MAGIC_SO" "$QQ_MAGIC_CPP" -ldl 2>&1; then
                echo "[Info] qq_magic.so compiled at $QQ_MAGIC_SO"
            else
                echo "[Warning] qq_magic.so compile failed; native modules may fail to load."
            fi
        else
            echo "[Warning] g++ not available. Install build-essential (Debian/Ubuntu)"
            echo "          or @development tools (RHEL/Fedora) and re-run, or"
            echo "          drop a pre-built qq_magic.so next to this script."
        fi
    fi

    # 2b. Build libnapcat_launcher.so if missing — the package.json/loadNapCat.js
    # hook that lets QQ Electron boot into napcat.mjs (issue #433).
    LAUNCHER_SO="$SCRIPT_DIR/libnapcat_launcher.so"
    LAUNCHER_CPP="$SCRIPT_DIR/launcher.cpp"
    if [ ! -f "$LAUNCHER_SO" ]; then
        echo "[Info] libnapcat_launcher.so missing, attempting in-place compile..."
        if [ ! -f "$LAUNCHER_CPP" ]; then
            echo "[Error] launcher.cpp not bundled. Re-download the release tarball or"
            echo "        copy it from https://github.com/shuakami/qq-chat-exporter/"
            echo "        blob/master/scripts/napcat-launcher/launcher.cpp"
            exit 1
        fi
        if command -v g++ >/dev/null 2>&1; then
            if g++ -shared -fPIC -O2 -o "$LAUNCHER_SO" "$LAUNCHER_CPP" -ldl 2>&1; then
                echo "[Info] libnapcat_launcher.so compiled at $LAUNCHER_SO"
            else
                echo "[Error] libnapcat_launcher.so compile failed. QCE cannot run on"
                echo "        Linux without this shim — install build-essential and retry."
                exit 1
            fi
        else
            echo "[Error] g++ not available. Install build-essential (Debian/Ubuntu)"
            echo "        or @development tools (RHEL/Fedora) and re-run."
            exit 1
        fi
    fi

    # 2c. libbugly.so references gnutls_* symbols but ships without a NEEDED
    # entry for libgnutls.so.30; preload the system copy if present.
    LIBGNUTLS=""
    if [ -f "$QQ_DIR/resources/app/libbugly.so" ]; then
        LIBGNUTLS=$(ldconfig -p 2>/dev/null | awk -F'=> ' '/libgnutls\.so\.30/ { print $2; exit }' | tr -d '[:space:]')
        if [ -z "$LIBGNUTLS" ] || [ ! -f "$LIBGNUTLS" ]; then
            echo "[Warning] libgnutls.so.30 not found; QQ libbugly.so may fail to load."
            echo "          Debian/Ubuntu: sudo apt-get install -y libgnutls30"
            echo "          RHEL/Fedora:   sudo dnf install -y gnutls"
            LIBGNUTLS=""
        fi
    fi

    # Compose LD_PRELOAD. Order matters: the launcher hook must load before
    # anything that opens package.json (which is essentially everything).
    LD_PRELOAD_PARTS="$LAUNCHER_SO"
    [ -f "$QQ_MAGIC_SO" ] && LD_PRELOAD_PARTS="$LD_PRELOAD_PARTS:$QQ_MAGIC_SO"
    [ -n "$LIBGNUTLS" ] && LD_PRELOAD_PARTS="$LD_PRELOAD_PARTS:$LIBGNUTLS"
    export LD_PRELOAD="$LD_PRELOAD_PARTS${LD_PRELOAD:+:$LD_PRELOAD}"
    echo "[Info] LD_PRELOAD: $LD_PRELOAD"

    # 2d. Inputs the launcher shim reads.
    export NAPCAT_BOOTMAIN="$SCRIPT_DIR"
    export NAPCAT_QQ_PKG_JSON="$QQ_PKG_JSON"

    # 2e. Single-process mode by default — see comments at the top.
    : "${NAPCAT_DISABLE_MULTI_PROCESS:=1}"
    export NAPCAT_DISABLE_MULTI_PROCESS

    # 2f. Headless safety net. QQ is an Electron app and needs a display
    # server. On desktops this is already there. On headless servers (Docker,
    # SSH, CI) we fall back to xvfb-run so QQ has a virtual X session.
    DISPLAY_VAR="${DISPLAY:-}"
    WAYLAND_VAR="${WAYLAND_DISPLAY:-}"
    XVFB_PREFIX=()
    if [ -z "$DISPLAY_VAR" ] && [ -z "$WAYLAND_VAR" ]; then
        if command -v xvfb-run >/dev/null 2>&1; then
            echo "[Info] No DISPLAY detected; wrapping QQ in xvfb-run."
            XVFB_PREFIX=(xvfb-run -a --server-args="-screen 0 1280x720x24")
        else
            echo "[Warning] No DISPLAY and xvfb-run is not installed."
            echo "          On headless boxes, install xvfb first:"
            echo "          Debian/Ubuntu: sudo apt-get install -y xvfb"
            echo "          RHEL/Fedora:   sudo dnf install -y xorg-x11-server-Xvfb"
            echo "          Continuing anyway — QQ may fail to start."
        fi
    fi

    echo "Starting NapCat + QCE (Linux Electron mode, issue #433)..."
    echo "Press Ctrl+C to stop."
    echo "After QQ login, open http://localhost:40653/qce/ in your browser."
    echo ""

    exec "${XVFB_PREFIX[@]}" "$NAPCAT_QQ_PATH" --no-sandbox
fi

# --- 3. Node bootstrap flow (macOS, and Linux legacy mode) ------------------

if [[ "${OSTYPE:-}" == linux* ]] && [ "$QCE_LEGACY_LAUNCH" == "1" ]; then
    echo "[Info] Legacy launch mode enabled (--legacy / QCE_LINUX_LEGACY_LAUNCH)."
    echo "       Running NapCat as a standalone Node.js process so the desktop"
    echo "       QQ client can stay online at the same time (issue #469)."
    echo "       Note: on some distros this path may segfault on login"
    echo "       (issue #433); drop the flag to use the default Electron launcher."
fi

if ! command -v node >/dev/null 2>&1; then
    echo "[Error] node not found. Install Node.js 18+ from https://nodejs.org/."
    exit 1
fi

export NAPCAT_MAIN_PATH="$SCRIPT_DIR/napcat-bootstrap.mjs"

echo "Starting NapCat + QCE..."
echo "Press Ctrl+C to stop."
echo "After QQ login, open http://localhost:40653/qce/ in your browser."
echo ""

exec node "$NAPCAT_MAIN_PATH"
