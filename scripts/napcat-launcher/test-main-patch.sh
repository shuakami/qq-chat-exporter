#!/bin/sh
# Regression test for the macOS runtime copy's package.json patch.
#
# launcher-user.sh rewrites "main" to ./loadNapCat-qce.js in its private copy
# of QQ.app so NapCat's napcat.mjs loads inside QQ's own Electron runtime.
# That used to be done with `sed -i ''`, which silently no-ops under GNU sed
# and toybox sed: they parse the following '' as a filename rather than as the
# backup suffix, so nothing is substituted and sed exits non-zero unnoticed.
# The copy then boots QQ's own entry point, NapCat never loads, and the
# launcher waits forever on a QR code that is never generated — with no error
# pointing at the real cause.
#
# Usage: sh scripts/napcat-launcher/test-main-patch.sh
# Exits non-zero on failure. Needs only a POSIX shell and sed.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
LAUNCHER="$SCRIPT_DIR/launcher-user.sh"

fail() {
    printf 'FAIL: %s\n' "$1"
    exit 1
}

pass() {
    printf 'ok:   %s\n' "$1"
}

[ -f "$LAUNCHER" ] || fail "launcher not found at $LAUNCHER"

# 1. No in-place sed anywhere in executable code.
#    sed -i is exactly the portability trap this test exists for: BSD requires
#    a suffix argument, GNU sed and toybox sed treat it as a filename. Comment
#    lines are stripped first so that explaining the trap in launcher-user.sh
#    does not itself trip the check.
if sed 's/[[:space:]]*#.*$//' "$LAUNCHER" | grep -qE 'sed[[:space:]]+-i'; then
    fail "launcher-user.sh uses 'sed -i'; use redirect + mv instead"
fi
pass "no in-place sed in launcher-user.sh"

# 2. The substitution actually rewrites the field.
#    The expression is read out of launcher-user.sh rather than duplicated
#    here, so the test cannot silently drift from the shipped one.
EXPR=$(grep -oE "sed -E '[^']*loadNapCat-qce[^']*'" "$LAUNCHER" | head -1 |
    sed -E "s/^sed -E '//; s/'\$//")
[ -n "$EXPR" ] || fail "could not extract the main-field substitution from launcher-user.sh"
printf 'info: expression under test: %s\n' "$EXPR"
printf 'info: sed under test:        %s\n' "$(command -v sed)"

FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/qce-main-patch.XXXXXX")
trap 'rm -rf "$FIXTURE_DIR"' EXIT INT TERM

FIXTURE="$FIXTURE_DIR/package.json"
printf '{"name":"qq","main":"./application.asar/app_launcher/index.js","version":"6.9.95-48517"}\n' >"$FIXTURE"

sed -E "$EXPR" "$FIXTURE" >"$FIXTURE_DIR/patched" || fail "sed exited non-zero for: $EXPR"
mv "$FIXTURE_DIR/patched" "$FIXTURE"

if ! grep -q '"main": *"\.\/loadNapCat-qce\.js"' "$FIXTURE"; then
    printf 'info: produced %s\n' "$(cat "$FIXTURE")"
    fail "main field was not rewritten"
fi
pass "main field rewritten"

# 3. The substitution must not touch anything else in the manifest.
grep -q '"version": *"6.9.95-48517"' "$FIXTURE" || fail "substitution clobbered other fields"
grep -q '"name": *"qq"' "$FIXTURE" || fail "substitution clobbered other fields"
pass "other fields untouched"

printf '\nall checks passed\n'
