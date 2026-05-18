#!/bin/bash
# Build the QCE Linux launcher shim (libnapcat_launcher.so).
#
# Invoked both during release packaging (scripts/quick-pack.py) and as an
# in-place fallback from launcher-user.sh when the shipped .so is missing
# (e.g. user is on a Linux arch we did not pre-build for).
#
# Usage:
#   ./build.sh [out_path]
#
# The output path defaults to ./libnapcat_launcher.so next to the script.

set -u

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CPP="$SCRIPT_DIR/launcher.cpp"
OUT="${1:-$SCRIPT_DIR/libnapcat_launcher.so}"

if [ ! -f "$CPP" ]; then
    echo "[build.sh] launcher.cpp not found at $CPP" >&2
    exit 1
fi

if ! command -v g++ >/dev/null 2>&1; then
    echo "[build.sh] g++ not available. Install build-essential (Debian/Ubuntu)" >&2
    echo "           or @development tools (RHEL/Fedora) and re-run." >&2
    exit 1
fi

g++ -shared -fPIC -O2 -o "$OUT" "$CPP" -ldl
echo "[build.sh] built $OUT"
