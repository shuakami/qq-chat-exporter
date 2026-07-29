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
#   small loader we drop next to it, then re-sign only the outer bundle
#   (ad-hoc, no --deep — this leaves nested Frameworks/Helpers' own
#   signatures untouched) so Gatekeeper does not refuse to launch the
#   now-modified bundle ("already damaged").
#
#   Critically, this patch + re-sign runs against a **private copy** of
#   QQ.app under this pack directory (macos_prepare_qq_runtime below), never
#   against the user's real /Applications/QQ.app. Re-signing necessarily
#   drops App Sandbox (see the next paragraph), and that is a property of the
#   signature itself — it applies no matter how the bundle is later launched.
#   Confirmed on real hardware: patching the real QQ.app in place also broke
#   launching it normally, outside QCE — it lost its sandboxed data directory
#   (so it couldn't find existing chat history) and crash-looped on its own
#   GPU/Network Service child processes, same as the unpatched bug. Copying
#   first means the user's everyday QQ.app is never touched at all.
#
#   Two more real-machine findings shape the launch flags below:
#     - Ad-hoc re-signing cannot grant `com.apple.security.application-groups`
#       (it requires a real Apple-issued provisioning profile), so the
#       entitlements below deliberately omit App Sandbox/App Group. Without
#       this, the runtime copy hangs during its own container init instead.
#     - Under that reduced signature, Chromium's GPU and Network Service
#       *child* processes fail to spawn correctly (GPU crashes fatally within
#       seconds; Network Service crash-loops forever). `--single-process`
#       avoids spawning them at all, which is an acceptable trade-off for a
#       backend-only NapCat bot process that never renders a window.
#
#   Dropping App Sandbox also moves where QQ keeps its databases, which is why
#   macos_link_qq_data_store below exists — without it the copy starts from an
#   empty message store and one-to-one chat history cannot be exported. Since
#   the copy and the desktop client then share one store (and one PC-login
#   slot), the desktop QQ must be fully quit before starting; the launcher
#   checks this up front rather than letting QQ hang on the QR screen.

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

    QQ_APP_DIR="$(dirname "$(dirname "$QQ_DIR")")"       # .../QQ.app (the real, untouched install)

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
        # Shallow (no --deep): this re-seals Contents/Resources (which now
        # includes our patched package.json and new loadNapCat-qce.js) and
        # re-signs the main executable with the entitlements above. Nested
        # Frameworks/Helpers keep their own original signatures untouched —
        # --deep would try to re-sign those too and fail, since most of them
        # declare com.apple.security.application-groups, which ad-hoc
        # signing cannot grant (it needs a real Apple provisioning profile).
        #
        # Deliberately NOT included above: com.apple.security.app-sandbox and
        # com.apple.security.application-groups. The real QQ.app ships with
        # both, but an ad-hoc signature can't obtain real App Group
        # authorization for them; keeping app-sandbox=true without it makes
        # QQ hang silently during its own container init (confirmed on real
        # hardware) instead of erroring out. This only affects the private
        # runtime copy — the real QQ.app keeps its original, fully sandboxed,
        # Apple-signed entitlements untouched.
        echo "[Info] Re-signing the private runtime copy (ad-hoc)..."
        if ! codesign --force --sign - --entitlements "$entitlements_plist" "$QQ_RUNTIME_APP_DIR" 2>&1; then
            rm -f "$entitlements_plist"
            echo "[Error] codesign failed on $QQ_RUNTIME_APP_DIR."
            echo "        Delete it and re-run to start over:"
            echo "          rm -rf \"$QQ_RUNTIME_APP_DIR\""
            exit 1
        fi
        rm -f "$entitlements_plist"
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

        local original_main
        original_main=$(grep -oE '"main": *"[^"]*"' "$QQ_RUNTIME_PKG_JSON" | head -1 | sed -E 's/"main": *"([^"]*)"/\1/')
        if [ -z "$original_main" ]; then
            echo "[Error] Could not find a \"main\" field in $QQ_RUNTIME_PKG_JSON."
            echo "        QQ may have changed its packaging; please file an issue."
            exit 1
        fi

        cat > "$QQ_RUNTIME_LOADER_PATH" <<LOADER_EOF
// Auto-generated by launcher-user.sh (QCE macOS support), inside QCE's
// private copy of QQ.app — never the real /Applications/QQ.app. Re-running
// launcher-user.sh regenerates this file. package.json's "main" field points
// here instead of the copy's own entry so NapCat's napcat.mjs can load inside
// the real QQ Electron runtime. The QCE_NAPCAT_ENTRY fallback below exists
// only as a defensive default for this copy; the real QQ.app you use day to
// day is a separate, untouched file and always uses its original entry.
const { pathToFileURL } = require('url');
if (process.env.QCE_NAPCAT_ENTRY === '1') {
  const napcatPath = process.env.QCE_NAPCAT_MJS_PATH;
  import(pathToFileURL(napcatPath).href).catch((e) => {
    console.error('[QCE] failed to import napcat.mjs:', e);
    process.exit(1);
  });
} else {
  require('$original_main');
}
LOADER_EOF

        # In-place edit of the "main" field only, in the private copy.
        sed -i '' -E 's/"main": *"[^"]*"/"main": ".\/loadNapCat-qce.js"/' "$QQ_RUNTIME_PKG_JSON"

        macos_resign_qq_runtime
        qq_source_version_marker > "$QQ_RUNTIME_SOURCE_MARKER"
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
    : "${NAPCAT_DISABLE_MULTI_PROCESS:=1}"
    export NAPCAT_DISABLE_MULTI_PROCESS

    echo "Starting NapCat + QCE (macOS)..."
    echo "Press Ctrl+C to stop."
    echo "Keep the desktop QQ closed while this runs: nothing stops it from"
    echo "starting, but the two then read and write one message database and"
    echo "compete for the same PC login slot."
    echo "After QQ login, open http://localhost:40653/qce/ in your browser."
    echo ""

    # --single-process --disable-gpu: Chromium's GPU and Network Service
    # child processes cannot spawn correctly under the re-signed runtime copy
    # (see the flow comment above); this is a headless bot process that never
    # renders a window anyway, so running everything in one process is an
    # acceptable trade-off. Extra arguments (e.g. -q <uin> for quick login)
    # are forwarded through. Note this execs the *private copy*, not
    # NAPCAT_QQ_PATH — the real QQ.app is never launched by this script.
    exec "$QQ_RUNTIME_BINARY" --single-process --disable-gpu "$@"
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
