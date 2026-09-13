#!/usr/bin/env python3
"""Exercise the real launcher signing functions with an isolated codesign mock.

Run with: python3 scripts/napcat-launcher/tests/macos-signing.test.py
No QQ processes or real codesign commands are launched.
"""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


LAUNCHER = Path(__file__).resolve().parents[1] / "launcher-user.sh"
HELPERS = (
    "QQ Helper.app", "QQ Helper (GPU).app",
    "QQ Helper (Plugin).app", "QQ Helper (Renderer).app",
)


def extract_function(source, name):
    """Retain the function verbatim, ignoring braces inside shell heredocs."""
    lines = source.splitlines(keepends=True)
    start = next(i for i, line in enumerate(lines)
                 if line.rstrip() == f"    {name}() {{")
    heredoc = None
    for end in range(start + 1, len(lines)):
        line = lines[end].rstrip("\n")
        if heredoc:
            if line == heredoc:
                heredoc = None
            continue
        match = re.search(r"<<\s*['\"]?([A-Za-z_][A-Za-z_0-9]*)", line)
        if match:
            heredoc = match.group(1)
        elif line == "    }":
            return "".join(lines[start:end + 1])
    raise AssertionError(f"No closing brace found for {name}")


MOCK_CODESIGN = r'''
import json, os, pathlib, plistlib, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ['QCE_TEST_ROOT'])
app = root / 'QQNapCatRuntime.app'
target = pathlib.Path(args[-1])
assert target == app or target.parent == app / 'Contents/Frameworks', args
operation = 'verify' if '--verify' in args else 'sign'
record = {'operation': operation, 'target': target.name,
          'marker_exists': (root / '.qce-runtime-patch-version').exists()}
if operation == 'sign':
    assert '--deep' not in args, 'sign nested bundles explicitly'
    with open(args[args.index('--entitlements') + 1], 'rb') as stream:
        record['entitlements'] = plistlib.load(stream)
with (root / 'codesign.jsonl').open('a') as stream:
    stream.write(json.dumps(record) + '\n')
config = json.loads((root / 'mock-config.json').read_text())
signature = root / 'mock-valid-signature'
if operation == 'verify':
    if not config.get('fail_verify') and signature.exists() and config.get('fail_marker_write'):
        (root / '.qce-runtime-patch-version').mkdir()
    sys.exit(1 if config.get('fail_verify') or not signature.exists() else 0)
if target.name == config.get('fail_target'):
    sys.exit(1)
if target == app:
    signature.touch()
'''


class MacosSigningCacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = LAUNCHER.read_text()
        cls.functions = "\n".join(extract_function(source, name) for name in (
            "macos_resign_qq_runtime", "macos_patch_runtime_loader"))
        cls.revision = re.search(
            r"^    QQ_RUNTIME_PATCH_VERSION=(\S+)$", source, re.M).group(1)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="qce signing test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / "QQNapCatRuntime.app"
        self.loader = self.app / "Contents/Resources/app/loadNapCat-qce.js"
        self.loader.parent.mkdir(parents=True)
        for name in HELPERS:
            (self.app / "Contents/Frameworks" / name).mkdir(parents=True)
        self.marker = self.root / ".qce-runtime-patch-version"
        self.trace = self.root / "codesign.jsonl"
        self.signature = self.root / "mock-valid-signature"
        self.mock = self.root / "mock-codesign.py"
        self.mock.write_text(MOCK_CODESIGN)
        self.script = self.root / "test.sh"
        self.script.write_text("""set -u
codesign() { "$QCE_TEST_PYTHON" "$QCE_TEST_CODESIGN" "$@"; }
mktemp() {
  "$QCE_TEST_PYTHON" -c 'import os,sys,tempfile; fd,p=tempfile.mkstemp(dir=sys.argv[1]); os.close(fd); print(p)' "$QCE_TEST_ROOT"
}
""" + self.functions + "\nmacos_patch_runtime_loader\necho PATCH_RETURNED\n")

    def run_patch(self, **config):
        self.trace.write_text("")
        (self.root / "mock-config.json").write_text(json.dumps(config))
        env = dict(os.environ, QCE_TEST_ROOT=str(self.root),
                   QCE_TEST_PYTHON=sys.executable, QCE_TEST_CODESIGN=str(self.mock),
                   QQ_RUNTIME_APP_DIR=str(self.app),
                   QQ_RUNTIME_LOADER_PATH=str(self.loader),
                   QQ_RUNTIME_PATCH_MARKER=str(self.marker),
                   QQ_RUNTIME_PATCH_VERSION=self.revision)
        result = subprocess.run(["bash", str(self.script)], env=env,
                                capture_output=True, text=True, timeout=15)
        calls = [json.loads(line) for line in self.trace.read_text().splitlines()]
        return result, calls

    def assert_signed_and_verified(self, calls):
        signs = [call for call in calls if call["operation"] == "sign"]
        self.assertEqual({call["target"] for call in signs[:-1]}, set(HELPERS))
        self.assertEqual(len(signs), 5)
        self.assertEqual(signs[-1]["target"], self.app.name)
        self.assertEqual(calls[-1]["operation"], "verify")
        for call in signs:
            self.assertFalse(call["marker_exists"], "marker precedes successful signing")
            for forbidden in ("app-sandbox", "inherit", "application-groups"):
                self.assertNotIn("com.apple.security." + forbidden, call["entitlements"])
            self.assertTrue(call["entitlements"]["com.apple.security.cs.allow-jit"])
            self.assertTrue(call["entitlements"]["com.apple.security.cs.disable-library-validation"])
        self.assertEqual(self.marker.read_text().strip(), self.revision)

    def seed_valid_cache(self):
        result, calls = self.run_patch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_signed_and_verified(calls)

    def test_helper_failure_invalidates_marker_and_next_run_retries(self):
        self.seed_valid_cache()
        self.marker.write_text("outdated\n")
        original_loader = self.loader.read_bytes()
        result, calls = self.run_patch(fail_target="QQ Helper (Plugin).app")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.marker.exists())
        self.assertNotIn("PATCH_RETURNED", result.stdout)
        self.assertFalse(any(call["target"] == self.app.name for call in calls))
        self.assertEqual(self.loader.read_bytes(), original_loader)
        result, calls = self.run_patch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_signed_and_verified(calls)

    def test_patch_marker_invalidation_failure_stops_before_signing(self):
        self.marker.mkdir()
        result, calls = self.run_patch()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("PATCH_RETURNED", result.stdout)
        self.assertEqual(calls, [])

    def test_patch_marker_write_failure_does_not_report_ready(self):
        result, calls = self.run_patch(fail_marker_write=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("PATCH_RETURNED", result.stdout)
        self.assertFalse(self.marker.is_file())
        self.assertEqual(calls[-1]["operation"], "verify")

    def test_cache_hit_only_verifies_without_rewriting_loader(self):
        self.seed_valid_cache()
        before = self.loader.stat().st_mtime_ns
        result, calls = self.run_patch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([call["operation"] for call in calls], ["verify"])
        self.assertEqual(self.loader.stat().st_mtime_ns, before)

    def test_invalid_cached_signature_is_repaired(self):
        self.seed_valid_cache()
        self.signature.unlink()
        result, calls = self.run_patch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls[0]["operation"], "verify")
        self.assert_signed_and_verified(calls)

    def test_revision_change_resigns_even_when_loader_is_unchanged(self):
        self.seed_valid_cache()
        self.marker.write_text("outdated\n")
        result, calls = self.run_patch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_signed_and_verified(calls)

    def test_main_signature_failure_never_writes_marker(self):
        result, calls = self.run_patch(fail_target=self.app.name)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.marker.exists())
        self.assertEqual(calls[-1]["target"], self.app.name)
        self.assertNotIn("PATCH_RETURNED", result.stdout)

    def test_final_verification_failure_never_writes_marker(self):
        result, calls = self.run_patch(fail_verify=True)
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.marker.exists())
        self.assertEqual(calls[-1]["operation"], "verify")
        self.assertFalse(calls[-1]["marker_exists"])
        self.assertNotIn("PATCH_RETURNED", result.stdout)




class MacosLaunchModeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="qce mode test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "config").mkdir()
        function = extract_function(LAUNCHER.read_text(), "macos_validate_launch_mode")
        self.script = self.root / "mode.sh"
        self.script.write_text(function + '\nmacos_validate_launch_mode "$@" || exit 1\n'
                               + 'echo "VALIDATED:$NAPCAT_DISABLE_MULTI_PROCESS"\n')

    def check_mode(self, args=(), env_file="", **variables):
        (self.root / "config/.env").write_text(env_file)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("NAPCAT_")}
        env.update(SCRIPT_DIR=str(self.root), **variables)
        return subprocess.run(["bash", str(self.script), *args], env=env,
                              capture_output=True, text=True, timeout=5)

    def test_normal_options_preserve_supported_mode(self):
        result = self.check_mode(("-q", "000000"), NAPCAT_DISABLE_MULTI_PROCESS="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("VALIDATED:1", result.stdout)

    def test_single_process_switch_cannot_be_reintroduced(self):
        for argument in ("--single-process", "--single-process=true", "--single-process=0"):
            with self.subTest(argument=argument):
                result = self.check_mode((argument,))
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("VALIDATED:", result.stdout)

    def test_env_file_cannot_enable_worker_mode(self):
        result = self.check_mode(env_file="NAPCAT_DISABLE_MULTI_PROCESS=0\n")
        self.assertNotEqual(result.returncode, 0)

    def test_worker_alias_and_last_env_file_assignment_match_napcat(self):
        result = self.check_mode(env_file=(
            "# settings\r\n NAPCAT_DISABLE_MULTI_PROCESS = 0 \r\n"
            "NAPCAT_DISABLE_MULTIPROCESSING=0\r\n"
            "NAPCAT_DISABLE_MULTIPROCESSING=1\r\n"))
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.check_mode(env_file=(
            "NAPCAT_DISABLE_MULTI_PROCESS=1\nNAPCAT_DISABLE_MULTI_PROCESS=0\n"
            "NAPCAT_DISABLE_MULTIPROCESSING=0\n"), NAPCAT_DISABLE_MULTIPROCESSING="1")
        self.assertNotEqual(result.returncode, 0)

    def test_worker_process_role_is_rejected_from_environment_or_file(self):
        self.assertNotEqual(self.check_mode(NAPCAT_WORKER_PROCESS="1").returncode, 0)
        self.assertNotEqual(self.check_mode(env_file="NAPCAT_WORKER_PROCESS=1\n").returncode, 0)
        self.assertEqual(self.check_mode(env_file="NAPCAT_WORKER_PROCESS=0\n",
                                       NAPCAT_WORKER_PROCESS="1").returncode, 0)

if __name__ == "__main__":
    unittest.main(verbosity=2)
