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
# Legacy launch mode (issue #469, Linux only):
#   The Electron flow above drives the real QQ client, so QCE occupies the
#   same PC-login slot as the desktop QQ and the two cannot stay online at
#   once. Passing --legacy (or exporting QCE_LINUX_LEGACY_LAUNCH=1) restores
#   the pre-v5.5.64 behaviour: NapCat runs as a standalone Node.js process
#   via napcat-bootstrap.mjs, which coexists with the desktop QQ client. The
#   trade-off is that some distros segfault on login under this path
#   (issue #433). There is no macOS equivalent: the Node.js path never loaded
#   NapCat on macOS in the first place (see below), so there is nothing to
#   fall back to.
#
# macOS flow:
#   Running `node napcat-bootstrap.mjs` (the previous approach, still used by
#   Linux legacy mode below) never actually loads napcat.mjs on macOS: it
#   overrides process.execPath to the QQ binary and forks a "worker" with
#   Node's child_process.fork(), which re-execs the QQ binary passing
#   napcat.mjs as argv[1]. That trick only works against the generic,
#   unpackaged `electron` binary. `/Applications/QQ.app` is a signed, packaged
#   Electron app whose package.json `main` field is fixed at build time
#   (`./application.asar/app_launcher/index.js`); a packaged app's main
#   process ignores an extra positional argument (it is handed to the app's
#   own code as an "open this file" request, the same as dragging a file onto
#   the Dock icon). The result: QQ boots completely normally and NapCat's own
#   code never runs, so the launcher hangs forever with no error — no QR
#   code, no port, nothing.
#
#   The fix mirrors the Linux LD_PRELOAD trick's *goal* (get QQ's own
#   Electron process to load napcat.mjs as its main script) but not its
#   *mechanism*: dyld's `__interpose` cannot reliably intercept file reads
#   made by system frameworks that live in the dyld shared cache (Apple has
#   progressively locked this down since macOS 11; `DYLD_SHARED_REGION=avoid`
#   used to restore full interposability but no longer does anything under
#   Hardened Runtime). So instead of intercepting the read in memory, we
#   patch `Contents/Resources/app/package.json` on disk to point `main` at a
#   small loader we drop next to it, then ad-hoc sign the private copy.
#   Both the main executable and the four QQ Helpers must use compatible
#   non-App-Sandbox entitlements. Keeping sandbox-inherit on official Helpers
#   makes libsecinit abort because the patched main process has no sandbox.
#   Framework signatures remain untouched; each Helper is signed before the
#   outer bundle. The user's original /Applications/QQ.app is never modified.
#
#   Do not use Chromium's --single-process as a workaround for Helper crashes.
#   QQ's Electron 40 runtime can abort in uv_sem_post during shutdown when its
#   in-process renderer was never initialized. Compatible Helper signatures
#   let Chromium keep its regular process model. NapCat's separate worker
#   mode remains disabled through NAPCAT_DISABLE_MULTI_PROCESS=1.
#
#   Dropping App Sandbox also moves where QQ keeps its databases, which is why
#   macos_link_qq_data_store below exists — without it the copy starts from an
#   empty message store and one-to-one chat history cannot be exported. Since
#   the copy and the desktop client then share one store (and one PC-login
#   slot), the desktop QQ must be fully quit before starting; the launcher
#   checks this up front rather than letting QQ hang on the QR screen.

set -u

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd -P )"
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
if [[ "${OSTYPE:-}" == darwin* ]]; then
    # macOS bundle layout: .../QQ.app/Contents/MacOS/QQ (NAPCAT_QQ_PATH) and
    # .../QQ.app/Contents/Resources/app/package.json — Resources is a sibling
    # of MacOS, not a child of it, so the Linux-shaped
    # "$QQ_DIR/resources/app/package.json" (correct for the flat
    # /opt/QQ/{qq,resources/app/...} layout Linux installs use) always missed
    # on macOS. It only produced a [Warning] below, silently, so this went
    # unnoticed until the macOS patch step needed a real path to read/write.
    QQ_PKG_JSON="$(dirname "$QQ_DIR")/Resources/app/package.json"
else
    QQ_PKG_JSON="$QQ_DIR/resources/app/package.json"
fi
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

# --- 2b. macOS-specific runtime fixes (private copy + patch + re-sign) ----
#
# See the "macOS flow" comment block at the top of this file for why this
# is necessary and what each piece below is for.

if [[ "${OSTYPE:-}" == darwin* ]]; then
    macos_validate_launch_mode() {
        local argument env_file
        for argument in "$@"; do
            case "$argument" in
                --single-process|--single-process=*)
                    echo "[Error] --single-process is not supported by the macOS QCE runtime."
                    echo "        Remove that option; it can make QQ abort during shutdown."
                    return 1
                    ;;
            esac
        done
        # NapCat reads config/.env itself and lets it override exported values.
        # Check its effective worker switches before touching the QQ copy.
        env_file="$SCRIPT_DIR/config/.env"
        [ -f "$env_file" ] || env_file=/dev/null
        if ! awk '
            function trim(value) { sub(/^[[:space:]]+/, "", value); sub(/[[:space:]]+$/, "", value); return value }
            BEGIN {
                primary = "1"
                alternate = ENVIRON["NAPCAT_DISABLE_MULTIPROCESSING"]
                worker = ENVIRON["NAPCAT_WORKER_PROCESS"]
            }
            {
                line = trim($0)
                if (line == "" || substr(line, 1, 1) == "#") next
                separator = index(line, "=")
                if (!separator) next
                key = trim(substr(line, 1, separator - 1))
                value = trim(substr(line, separator + 1))
                if (value == "") next
                if (key == "NAPCAT_DISABLE_MULTI_PROCESS") primary = value
                if (key == "NAPCAT_DISABLE_MULTIPROCESSING") alternate = value
                if (key == "NAPCAT_WORKER_PROCESS") worker = value
            }
            END { if (worker == "1" || (primary != "1" && alternate != "1")) exit 1 }
        ' "$env_file"; then
            echo "[Error] NapCat worker mode is not supported by the macOS QCE launcher."
            echo "        Set NAPCAT_DISABLE_MULTI_PROCESS=1 and remove NAPCAT_WORKER_PROCESS=1"
            echo "        from the environment and config/.env before restarting."
            return 1
        fi
        export NAPCAT_DISABLE_MULTI_PROCESS=1
    }
    macos_validate_launch_mode "$@" || exit 1

    # Defensively strip com.apple.quarantine (and any other xattrs) from the
    # Mach-O we actually execve()/dlopen(): qce-server and the native/*.node
    # addons. Unlike the .sh/.js/.mjs files elsewhere in this package, Apple
    # Silicon's AMFI enforces code-signing on every execve()/dlopen() of these
    # regardless of how they're invoked — an ad-hoc-signed, still-quarantined
    # binary gets silently SIGKILLed the instant it's spawned, before it can
    # log anything (confirmed on real hardware: qce-server died on launch,
    # QQ/NapCat kept running fine, and the web UI was simply unreachable with
    # no error dialog at all). Nothing in the docs asks users to clear the
    # attribute themselves, and extracting from Terminal does not avoid it
    # either: macOS propagates the archive's own quarantine to every extracted
    # file whatever the tool -- verified with `tar -xf` on a Safari-downloaded
    # release tarball, where qce-server came out quarantined just as it does
    # via Finder. This strip is therefore the only thing that keeps a
    # browser-downloaded package runnable; do not drop it as redundant.
    [ -e "$SCRIPT_DIR/qce-server" ] && xattr -cr "$SCRIPT_DIR/qce-server" 2>/dev/null
    [ -d "$SCRIPT_DIR/native" ] && xattr -cr "$SCRIPT_DIR/native" 2>/dev/null

    if [ ! -f "$QQ_PKG_JSON" ]; then
        echo "[Error] $QQ_PKG_JSON not found; cannot patch QQ for NapCat."
        echo "        Make sure NAPCAT_QQ_PATH points at the real QQ binary"
        echo "        inside QQ.app, not a symlink to it."
        exit 1
    fi

    QQ_APP_DIR="$(cd "$(dirname "$(dirname "$QQ_DIR")")" && pwd -P)"       # .../QQ.app (the real, untouched install)

    # The runtime copy and the desktop client share one PC-login slot, and (see
    # macos_link_qq_data_store below) one message store. If QQ is already
    # running, login simply never completes — QQ sits on the QR screen and
    # reports the account as signed in elsewhere, with nothing in the log to
    # explain it. Fail up front, before the multi-second copy step.
    if pgrep -f "$NAPCAT_QQ_PATH" >/dev/null 2>&1; then
        echo "[Error] The desktop QQ client is still running."
        echo "        QCE drives its own copy of QQ and the two share one PC"
        echo "        login slot, so QQ has to be fully quit first:"
        echo "          right-click QQ in the Dock -> Quit, or press Cmd+Q in QQ"
        echo "        (closing the window is not enough — QQ keeps running)"
        exit 1
    fi

    # We never patch/re-sign $QQ_APP_DIR in place. Re-signing removes App
    # Sandbox (see macos_resign_qq_runtime below for why), and that entitlement
    # change applies to the bundle regardless of how it is later launched —
    # confirmed on real hardware: after in-place patching, double-clicking
    # QQ.app normally (outside QCE) also lost its sandboxed data directory
    # (looked for chat history in the wrong place) and crash-looped on its own
    # GPU/Network Service child processes, exactly like the unpatched bug.
    # Everyday QQ use must stay on the pristine, Apple-signed original.
    #
    # So instead we maintain our own private copy under this pack directory,
    # patch and re-sign *that*, and only ever launch the copy. $QQ_APP_DIR is
    # read-only to us from here on (only used to detect version changes).
    QQ_RUNTIME_APP_DIR="$SCRIPT_DIR/QQNapCatRuntime.app"
    QQ_RUNTIME_BINARY="$QQ_RUNTIME_APP_DIR/Contents/MacOS/$(basename "$NAPCAT_QQ_PATH")"
    QQ_RUNTIME_RESOURCES_APP_DIR="$QQ_RUNTIME_APP_DIR/Contents/Resources/app"
    QQ_RUNTIME_PKG_JSON="$QQ_RUNTIME_RESOURCES_APP_DIR/package.json"
    QQ_RUNTIME_LOADER_PATH="$QQ_RUNTIME_RESOURCES_APP_DIR/loadNapCat-qce.js"
    # Deliberately a sibling of QQNapCatRuntime.app, not inside it: any file
    # dropped into the bundle after signing (even outside Contents/) trips
    # `codesign --verify --strict` ("unsealed contents present in the bundle
    # root") on the next run.
    QQ_RUNTIME_SOURCE_MARKER="$SCRIPT_DIR/.qce-runtime-source-version"
    QQ_RUNTIME_PATCH_MARKER="$SCRIPT_DIR/.qce-runtime-patch-version"
    QQ_RUNTIME_PATCH_VERSION=4

    if ps -axo comm= | grep -Fqx -- "$QQ_RUNTIME_BINARY"; then
        echo "[Info] QCE's private QQ runtime is already running."
        echo "       Use the existing QCE web page, or stop it before restarting."
        exit 0
    fi

    # Identifies the real QQ install's version, so a later QQ update can be
    # detected and the runtime copy refreshed instead of silently going stale.
    qq_source_version_marker() {
        grep -oE '"(version|buildVersion)": *"[^"]*"' "$QQ_PKG_JSON" 2>/dev/null | tr '\n' ' '
    }

    macos_resign_qq_runtime() {
        if ! command -v codesign >/dev/null 2>&1; then
            echo "[Error] codesign not found. Install Xcode Command Line Tools:"
            echo "          xcode-select --install"
            exit 1
        fi

        local entitlements_plist
        entitlements_plist="$(mktemp -t qce-qq-entitlements)"
        cat > "$entitlements_plist" <<'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.cs.disable-executable-page-protection</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.device.camera</key>
    <true/>
</dict>
</plist>
PLIST_EOF
        # These are private copies only. Remove App Sandbox/inherit and App
        # Group requirements consistently from Helpers and the main binary.
        # Re-sign nested app bundles first, without --deep: QQNT.framework and
        # other third-party framework signatures stay intact.
        local helper_app
        for helper_app in "$QQ_RUNTIME_APP_DIR/Contents/Frameworks"/QQ\ Helper*.app; do
            [ -d "$helper_app" ] || continue
            if ! codesign --force --sign - --entitlements "$entitlements_plist" "$helper_app" 2>&1; then
                rm -f "$entitlements_plist"
                echo "[Error] Could not sign a private QQ Helper."
                exit 1
            fi
        done
        echo "[Info] Re-signing the private runtime copy (ad-hoc)..."
        if ! codesign --force --sign - --entitlements "$entitlements_plist" "$QQ_RUNTIME_APP_DIR" 2>&1; then
            rm -f "$entitlements_plist"
            echo "[Error] codesign failed on $QQ_RUNTIME_APP_DIR."
            echo "        Delete it and re-run to start over:"
            echo "          rm -rf \"$QQ_RUNTIME_APP_DIR\""
            exit 1
        fi
        rm -f "$entitlements_plist"
        if ! codesign --verify --deep --strict "$QQ_RUNTIME_APP_DIR" 2>&1; then
            echo "[Error] The private QQ runtime signature did not validate."
            exit 1
        fi
    }

    # Refresh just our generated loader when its logic changes. The QQ
    # version alone cannot detect a launcher fix; do not recopy a GB for it.
    macos_patch_runtime_loader() {
        local generated_loader
        generated_loader="$(mktemp -t qce-macos-loader)"
        cat > "$generated_loader" <<'LOADER_EOF'
// QCE macOS loader revision 4. Generated from launcher-user.sh.
// This private bundle is only a backend runtime, never the desktop QQ app.
const { app } = require('electron');
const { pathToFileURL } = require('url');

if (process.env.QCE_NAPCAT_ENTRY !== '1') {
  // LaunchServices / CrashReporter Reopen does not preserve the launcher's
  // environment or switches. Never fall back to the sandboxed desktop entry.
  app.disableHardwareAcceleration();
  console.error('[QCE] Open launcher-user.sh or the QCE .command launcher to start this runtime.');
  app.exit(0);
} else {
  let stopping = false;
  async function stop(reason, code = 0) {
    if (stopping) return;
    stopping = true;
    console.log('[QCE] stopping runtime: ' + reason);
    const deadline = setTimeout(() => {
      console.error('[QCE] shutdown cleanup timed out');
      app.exit(1);
    }, 10000);
    try {
      // NapCat imports plugins with a cache-busting query. Importing the bare
      // file here would create a fresh module with no running server to stop.
      const bridge = globalThis.__NAPCAT_BRIDGE__;
      if (typeof bridge?.shutdown === 'function') {
        // Available before plugin_init finishes, so startup and stop cannot
        // race past each other and leave the Rust child running.
        await bridge.shutdown();
      } else {
        // Compatibility with older plugin packages already on disk.
        const context = bridge?.pluginContext;
        const plugin = context?.getPluginExports?.(context.pluginName);
        if (typeof plugin?.plugin_cleanup === 'function') {
          await plugin.plugin_cleanup(context);
        }
      }
    } catch (error) {
      console.error('[QCE] shutdown cleanup failed: ' + error.message);
      code = 1;
    }
    clearTimeout(deadline);
    app.exit(code);
  }
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => { void stop(signal); });
  }
  app.on('before-quit', event => {
    event.preventDefault();
    void stop('app quit');
  });
  import(pathToFileURL(process.env.QCE_NAPCAT_MJS_PATH).href).catch(error => {
    console.error('[QCE] failed to import napcat.mjs: ' + error.message);
    void stop('startup failure', 1);
  });
}
LOADER_EOF
        if cmp -s "$generated_loader" "$QQ_RUNTIME_LOADER_PATH" \
           && [ "$(cat "$QQ_RUNTIME_PATCH_MARKER" 2>/dev/null)" = "$QQ_RUNTIME_PATCH_VERSION" ] \
           && codesign --verify --deep --strict "$QQ_RUNTIME_APP_DIR" >/dev/null 2>&1; then
            rm -f "$generated_loader"
            return 0
        fi
        if ! rm -f "$QQ_RUNTIME_PATCH_MARKER"; then
            rm -f "$generated_loader"
            echo "[Error] Could not invalidate the private runtime patch marker."
            exit 1
        fi
        if ! cp "$generated_loader" "$QQ_RUNTIME_LOADER_PATH"; then
            rm -f "$generated_loader"
            echo "[Error] Could not update QCE's macOS loader."
            exit 1
        fi
        rm -f "$generated_loader"
        macos_resign_qq_runtime
        if ! printf '%s\n' "$QQ_RUNTIME_PATCH_VERSION" > "$QQ_RUNTIME_PATCH_MARKER"; then
            echo "[Error] Could not save the private runtime patch marker."
            exit 1
        fi
    }

    macos_prepare_qq_runtime() {
        # Guard against NAPCAT_QQ_PATH having been pointed at the runtime copy
        # itself (easy to do by pasting a path out of the log): the refresh
        # branch below would delete the copy and then try to ditto from the
        # directory it just removed.
        if [ "$QQ_APP_DIR" = "$QQ_RUNTIME_APP_DIR" ]; then
            echo "[Error] NAPCAT_QQ_PATH points at QCE's own runtime copy."
            echo "        Point it at the real install instead, e.g.:"
            echo "          export NAPCAT_QQ_PATH=/Applications/QQ.app/Contents/MacOS/QQ"
            exit 1
        fi

        # Idempotent: skip the (multi-second, ~1 GB) copy + re-sign unless the
        # runtime copy is missing/broken or the real QQ install has been
        # updated since we last copied it.
        if [ -f "$QQ_RUNTIME_PKG_JSON" ] \
           && [ -f "$QQ_RUNTIME_LOADER_PATH" ] \
           && grep -q '"main": *"\./loadNapCat-qce\.js"' "$QQ_RUNTIME_PKG_JSON" 2>/dev/null \
           && [ -f "$QQ_RUNTIME_SOURCE_MARKER" ] \
           && [ "$(cat "$QQ_RUNTIME_SOURCE_MARKER")" = "$(qq_source_version_marker)" ]; then
            return 0
        fi

        echo "[Info] Preparing a private, patched copy of QQ.app for NapCat"
        echo "       (first run, or QQ was updated) — this only touches the"
        echo "       copy; your real QQ.app in $QQ_APP_DIR is never modified."
        echo "       This copies ~1 GB and can take a little while."

        rm -rf "$QQ_RUNTIME_APP_DIR"
        if ! ditto "$QQ_APP_DIR" "$QQ_RUNTIME_APP_DIR"; then
            echo "[Error] Failed to copy $QQ_APP_DIR to $QQ_RUNTIME_APP_DIR."
            exit 1
        fi
        xattr -cr "$QQ_RUNTIME_APP_DIR" 2>/dev/null || true

        # Refuse to launch a copy whose package shape changed. A successful
        # sed command alone does not prove that it matched the main field.
        if ! sed -i '' -E 's/"main": *"[^"]*"/"main": ".\/loadNapCat-qce.js"/' "$QQ_RUNTIME_PKG_JSON" \
           || ! grep -q '"main": *"\./loadNapCat-qce\.js"' "$QQ_RUNTIME_PKG_JSON"; then
            echo "[Error] Could not install QCE's private QQ entry point."
            exit 1
        fi

        macos_patch_runtime_loader
        if ! qq_source_version_marker > "$QQ_RUNTIME_SOURCE_MARKER"; then
            echo "[Error] Could not save the QQ source version marker."
            exit 1
        fi
    }

    # Point the runtime copy at the desktop client's message store.
    #
    # App Sandbox rewrites NSHomeDirectory(), so the real QQ.app keeps its
    # databases under ~/Library/Containers/<bundle id>/Data/Library/..., while
    # our re-signed (and therefore sandbox-less) copy sees the actual home and
    # builds a brand new, empty store under ~/Library/Application Support/QQ.
    # That split is macOS-only: on Windows and Linux the Shell package and the
    # desktop client already read one and the same data directory, which is why
    # history export works there. Left alone, the copy can only export what the
    # server still hands back — group history is fetched server-side and looks
    # fine, but one-to-one chats come back nearly empty (buddy_msg_fts.db stays
    # at a few KB against the real store's megabytes).
    #
    # Symlinking the per-account store restores the Windows/Linux behaviour.
    # Nothing inside the container is created, moved or deleted here; the only
    # writes are symlinks under ~/Library/Application Support/QQ.
    #
    # Note the pgrep check above only runs at startup, and it cannot do more
    # than that: the copy is exec'd directly rather than through
    # LaunchServices, and its lock files live outside the sandbox container,
    # so nothing stops the desktop client from being launched afterwards.
    # Observed on real hardware: it then signs in as well, and both processes
    # end up holding the same message databases open. That is the same
    # situation a Windows user gets by running the Shell package alongside the
    # desktop client on one machine, and QQ's own storage layer is built for
    # concurrent access (MMKV in InterProcess mode, SQLite in WAL), so file
    # corruption is unlikely — but two independent clients writing one store
    # is not something anyone designed for, hence the warning printed below.
    macos_link_qq_data_store() {
        local bundle_id container_store live_store src dst name
        bundle_id=$(plutil -extract CFBundleIdentifier raw -o - "$QQ_APP_DIR/Contents/Info.plist" 2>/dev/null)
        [ -n "$bundle_id" ] || return 0
        container_store="$HOME/Library/Containers/$bundle_id/Data/Library/Application Support/QQ"
        [ -d "$container_store" ] || return 0   # desktop QQ has never signed in

        live_store="$HOME/Library/Application Support/QQ"
        mkdir -p "$live_store"
        for src in "$container_store"/nt_qq_*; do
            [ -d "$src" ] || continue           # no match: the glob stayed literal
            name=$(basename "$src")
            dst="$live_store/$name"
            if [ -L "$dst" ]; then
                [ "$(readlink "$dst")" = "$src" ] && continue
                rm -f "$dst"
            elif [ -d "$dst" ]; then
                # A store the copy built for itself, which happens whenever it
                # runs before the desktop client has ever signed in on this
                # Mac: the container holds no nt_qq_* yet, so there is nothing
                # to link and QQ starts a fresh one here.
                if [ -e "$dst.qce-unlinked-backup" ]; then
                    echo "[Warning] $name exists both as a real directory and as a backup."
                    echo "          Leaving it alone — the runtime copy will keep using its"
                    echo "          own store and older chat history will be missing."
                    continue
                fi
                mv "$dst" "$dst.qce-unlinked-backup" || continue
                echo "[Info] Moved the copy's own message store aside (safe to delete):"
                echo "       $dst.qce-unlinked-backup"
            fi
            ln -s "$src" "$dst"
            echo "[Info] Sharing the desktop QQ message store: $name"
        done
    }

    macos_prepare_qq_runtime
    macos_patch_runtime_loader
    macos_link_qq_data_store

    # NapCatPathWrapper defaults to ~/Library/Application Support/QQ/NapCat
    # on darwin; NAPCAT_WORKDIR overrides that to this pack directory, which
    # is where the plugin (plugins/napcat-plugin-qce) and qce-server already
    # live. This matches what Linux/Windows already do by default (their
    # binaryPath *is* the pack directory) and means plugin/qce-server
    # discovery work with zero extra copying.
    export NAPCAT_WORKDIR="$SCRIPT_DIR"
    export QCE_NAPCAT_ENTRY=1
    export QCE_NAPCAT_MJS_PATH="$SCRIPT_DIR/napcat.mjs"
    # macos_validate_launch_mode already forces the supported NapCat mode.
    export NAPCAT_DISABLE_MULTI_PROCESS=1

    echo "Starting NapCat + QCE (macOS)..."
    echo "Press Ctrl+C to stop."
    echo "Keep the desktop QQ closed while this runs: nothing stops it from"
    echo "starting, but the two then read and write one message database and"
    echo "compete for the same PC login slot."
    echo "After QQ login, open http://localhost:40653/qce/ in your browser."
    echo ""

    # Keep Chromium's normal process model. All private Helpers now have
    # compatible signatures. The desktop QQ install is never launched here.
    exec "$QQ_RUNTIME_BINARY" --disable-gpu --no-sandbox "$@"
fi

# --- 3. Node bootstrap flow (Linux legacy mode) -----------------------------

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
