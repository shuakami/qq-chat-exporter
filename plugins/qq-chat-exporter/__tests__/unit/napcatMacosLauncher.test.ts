/**
 * Tests for the macOS flow of scripts/napcat-launcher/launcher-user.sh.
 *
 * Unlike Linux, `/Applications/QQ.app` is a signed, packaged Electron app:
 * passing napcat.mjs as an extra argv entry (the previous approach, still
 * used by Linux legacy mode) is silently ignored by a packaged app's main
 * process, so NapCat's code never ran and the launcher hung forever with no
 * error. The fix patches a *private copy* of the QQ bundle's `package.json`
 * `main` field on disk to point at a generated loader, then re-signs the
 * private Helpers followed by the outer bundle (ad-hoc, without --deep).
 *
 * The copy is load-bearing, not cosmetic: re-signing necessarily drops App
 * Sandbox (ad-hoc signing cannot obtain the matching application-groups
 * authorization QQ ships with), and that is a property of the signature
 * itself — it applies no matter how the bundle is later launched. Patching
 * the real QQ.app in place was tried first and confirmed on real hardware to
 * also break launching it normally, outside QCE (it lost its sandboxed data
 * directory and crash-looped on its own GPU/Network Service child
 * processes, same symptoms as the original unpatched bug). Copying first
 * means the user's everyday QQ.app is never touched at all.
 *
 * These tests run the generated launcher against a throwaway fake ".app"
 * fixture standing in for /Applications/QQ.app (never a real QQ install) and
 * assert:
 *   1. The fixture itself (standing in for the user's real QQ.app) is never
 *      modified — this is the main safety property of the fix.
 *   2. A private runtime copy is created next to the launcher script, with
 *      `main` rewritten and a loader that refuses the desktop entry when
 *      opened outside the launcher.
 *   3. Re-running the launcher is idempotent (does not re-copy/re-patch/re-sign).
 *   4. An upstream QQ "update" (fixture's package.json changes) triggers a
 *      clean re-copy + re-patch.
 *   5. The runtime copy and all four real Mach-O Helper fixtures re-sign
 *      successfully and end up with the
 *      entitlements the fix depends on (disable-library-validation) while
 *      deliberately NOT regaining app-sandbox/inherit/application-groups.
 *   6. The launcher ultimately execs the runtime copy's (patched) QQ binary,
 *      not the original fixture's binary.
 *   7. The desktop client's per-account message store is symlinked into the
 *      unsandboxed location the copy actually reads, a store an older release
 *      left behind is moved aside rather than deleted, and nothing inside the
 *      sandbox container is touched.
 *   8. The launcher refuses to start (before the ~1 GB copy) while the
 *      desktop QQ client is running, since both share one PC-login slot and
 *      one message store.
 *   9. Selecting the runtime itself through a symlink cannot delete it.
 *
 * Skipped (not failed) when:
 *   - We're not on macOS (this flow is macOS-only).
 *   - codesign/cc is unavailable (should not happen on real macOS, but CI
 *     images can vary).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { createTempDir } from '../helpers/tempDir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LAUNCHER_SH = path.join(REPO_ROOT, 'scripts', 'napcat-launcher', 'launcher-user.sh');

function hasCodesign(): boolean {
    return spawnSync('codesign', ['--version'], { stdio: 'ignore' }).status === 0
        || spawnSync('which', ['codesign'], { stdio: 'ignore' }).status === 0;
}

function hasCc(): boolean {
    return spawnSync('cc', ['--version'], { stdio: 'ignore' }).status === 0;
}

const skipReason = process.platform !== 'darwin'
    ? 'macOS package.json patch flow is macOS-only'
    : !fs.existsSync(LAUNCHER_SH)
        ? 'launcher-user.sh not present'
        : !hasCc()
            ? 'cc not available (needed to build the fixture\'s Mach-O stub)'
            : !hasCodesign()
                ? 'codesign not available'
                : null;

interface FakeQqApp {
    appDir: string;
    qqBinary: string;
    packageJson: string;
    pristineBytes: Buffer;
    helpers: Array<{ appDir: string; binary: string; pristineBytes: Buffer }>;
}

function readEntitlements(appDir: string): string {
    const dump = spawnSync('codesign', ['-d', '--entitlements', ':-', appDir], { encoding: 'utf8' });
    assert.equal(dump.status, 0, `codesign -d --entitlements failed for ${appDir}: ${dump.stderr}`);
    return dump.stdout;
}

/**
 * Lay down a minimal-but-signable fake "QQ.app" fixture standing in for the
 * user's real /Applications/QQ.app — never a real QQ install. The stub
 * executable is a real compiled Mach-O (not a shell script): codesign only
 * embeds an entitlements blob it can later dump for genuine Mach-O binaries,
 * and the entitlements test below needs that to be meaningful.
 */
function stageFakeQqApp(tmpPath: string): FakeQqApp {
    const appDir = path.join(tmpPath, 'FakeQQ.app');
    const macosDir = path.join(appDir, 'Contents', 'MacOS');
    const resourcesAppDir = path.join(appDir, 'Contents', 'Resources', 'app');
    fs.mkdirSync(macosDir, { recursive: true });
    fs.mkdirSync(resourcesAppDir, { recursive: true });

    const qqBinary = path.join(macosDir, 'QQ');
    const stubSource = path.join(tmpPath, 'qq-stub.c');
    fs.writeFileSync(
        stubSource,
        '#include <stdio.h>\n'
        + 'int main(int argc, char **argv) {\n'
        + '  printf("QQ_EXECED");\n'
        + '  for (int i = 1; i < argc; i++) printf(" %s", argv[i]);\n'
        + '  printf("\\n");\n'
        + '  return 0;\n'
        + '}\n',
    );
    const compile = spawnSync('cc', ['-o', qqBinary, stubSource], { encoding: 'utf8' });
    if (compile.status !== 0) {
        throw new Error(`failed to compile fake QQ stub: ${compile.stderr}`);
    }

    // Model the nested applications shipped by QQ. They only need signable
    // Mach-O executables; none of these Helpers is ever launched. Sandbox
    // inheritance on the original signature makes a missed Helper re-sign
    // observable even if the outer bundle still verifies successfully.
    const helperEntitlements = path.join(tmpPath, 'original-helper-entitlements.plist');
    fs.writeFileSync(helperEntitlements, `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
    <key>com.apple.security.app-sandbox</key><true/>
    <key>com.apple.security.inherit</key><true/>
    <key>com.apple.security.application-groups</key>
    <array><string>group.qce-test-fixture</string></array>
    <key>com.apple.security.cs.allow-jit</key><true/>
</dict></plist>
`);
    const helpers = ['QQ Helper', 'QQ Helper (GPU)', 'QQ Helper (Plugin)', 'QQ Helper (Renderer)']
        .map((name, index) => {
            const helperApp = path.join(appDir, 'Contents', 'Frameworks', `${name}.app`);
            const binary = path.join(helperApp, 'Contents', 'MacOS', name);
            fs.mkdirSync(path.dirname(binary), { recursive: true });
            fs.copyFileSync(qqBinary, binary);
            fs.writeFileSync(path.join(helperApp, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
    <key>CFBundleExecutable</key><string>${name}</string>
    <key>CFBundleIdentifier</key><string>com.tencent.qq.qce-test-fixture.helper${index}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`);
            const sign = spawnSync('codesign', [
                '--force', '--sign', '-', '--entitlements', helperEntitlements, helperApp,
            ], { encoding: 'utf8' });
            assert.equal(sign.status, 0, `failed to sign fake ${name}: ${sign.stderr}`);
            return { appDir: helperApp, binary, pristineBytes: fs.readFileSync(binary) };
        });

    fs.writeFileSync(
        path.join(appDir, 'Contents', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>QQ</string>
    <key>CFBundleIdentifier</key>
    <string>com.tencent.qq.qce-test-fixture</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
</dict>
</plist>
`,
    );

    const packageJson = path.join(resourcesAppDir, 'package.json');
    const packageJsonContent = JSON.stringify(
        {
            name: 'qq-chat',
            version: '6.9.98-test',
            buildVersion: '00001',
            main: './application.asar/app_launcher/index.js',
        },
        null,
        2,
    );
    fs.writeFileSync(packageJson, packageJsonContent);

    // Real QQ.app ships bundle-signed, not just linker-signed (Apple Silicon
    // auto-signs the raw executable, but that alone leaves a bundle whose
    // Resources aren't sealed). Sign the whole fixture so "the original
    // signature still verifies after the launcher runs" is a real assertion.
    const sign = spawnSync('codesign', ['--force', '--sign', '-', appDir], { encoding: 'utf8' });
    if (sign.status !== 0) {
        throw new Error(`failed to sign fake QQ.app fixture: ${sign.stderr}`);
    }

    return { appDir, qqBinary, packageJson, pristineBytes: fs.readFileSync(qqBinary), helpers };
}

/** Copy launcher-user.sh into the sandbox so SCRIPT_DIR (and therefore the
 * runtime copy, logs, cache) land in the temp dir instead of the real repo. */
function stageLauncher(tmpPath: string): string {
    const launcher = path.join(tmpPath, 'launcher-user.sh');
    fs.copyFileSync(LAUNCHER_SH, launcher);
    fs.chmodSync(launcher, 0o755);
    return launcher;
}

/**
 * Always runs with HOME pointed at the sandbox. The launcher symlinks the
 * desktop client's message store into `$HOME/Library/Application Support/QQ`
 * (see macos_link_qq_data_store); with the real HOME these tests would reach
 * into the developer's own QQ data.
 */
function runLauncher(launcher: string, env: NodeJS.ProcessEnv) {
    const home = path.dirname(launcher);
    return spawnSync('bash', [launcher], { env: { ...env, HOME: home }, encoding: 'utf8' });
}

/** Block until `pgrep -f <needle>` sees a process, so the test is not racy. */
function waitForPgrep(needle: string, timeoutMs = 3000): boolean {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (spawnSync('pgrep', ['-f', needle], { stdio: 'ignore' }).status === 0) return true;
        spawnSync('sleep', ['0.05']);
    }
    return false;
}

/** Path of the sandboxed stand-in for the desktop client's sandbox container. */
function containerStoreDir(tmpPath: string): string {
    return path.join(
        tmpPath,
        'Library', 'Containers', 'com.tencent.qq.qce-test-fixture',
        'Data', 'Library', 'Application Support', 'QQ',
    );
}

/** Path of the unsandboxed location the re-signed runtime copy actually uses. */
function liveStoreDir(tmpPath: string): string {
    return path.join(tmpPath, 'Library', 'Application Support', 'QQ');
}

function runtimeAppDir(launcher: string): string {
    return path.join(path.dirname(launcher), 'QQNapCatRuntime.app');
}

test('macOS launcher: passes bash syntax check', { skip: skipReason ?? false }, () => {
    const r = spawnSync('bash', ['-n', LAUNCHER_SH], { encoding: 'utf8' });
    assert.equal(r.status, 0, `bash -n failed: ${r.stderr}`);
});

test('macOS launcher: never modifies the real QQ.app fixture, only a private copy', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-safety-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);
        const originalPackageJson = fs.readFileSync(fixture.packageJson, 'utf8');

        const r = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });
        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);

        assert.equal(
            fs.readFileSync(fixture.packageJson, 'utf8'),
            originalPackageJson,
            'the real QQ.app fixture\'s package.json must be byte-for-byte unchanged',
        );
        assert.ok(
            fixture.pristineBytes.equals(fs.readFileSync(fixture.qqBinary)),
            'the real QQ.app fixture\'s binary must be byte-for-byte unchanged',
        );
        assert.ok(
            !fs.existsSync(path.join(path.dirname(fixture.packageJson), 'loadNapCat-qce.js')),
            'no loader should ever be written into the real QQ.app fixture',
        );

        for (const helper of fixture.helpers) {
            assert.ok(helper.pristineBytes.equals(fs.readFileSync(helper.binary)),
                `${path.basename(helper.appDir)} in the original fixture must be byte-for-byte unchanged`);
            const entitlements = readEntitlements(helper.appDir);
            for (const key of ['app-sandbox', 'inherit', 'application-groups']) {
                assert.ok(entitlements.includes(`com.apple.security.${key}`),
                    `original ${path.basename(helper.appDir)} must retain ${key}`);
            }
        }
        const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', fixture.appDir], { encoding: 'utf8' });
        assert.equal(verify.status, 0, `real QQ.app fixture's original signature should still verify: ${verify.stderr}`);
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: patches the private copy, prevents desktop fallback, uses Chromium subprocesses', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-patch-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);

        const r = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });

        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);
        assert.ok(r.stdout.includes('QQ_EXECED'), `should exec the (patched) QQ binary, got: ${r.stdout}\n${r.stderr}`);
        assert.ok(!r.stdout.includes('--single-process'), 'must avoid the Electron single-process shutdown crash');
        assert.ok(r.stdout.includes('--disable-gpu'), 'should launch with --disable-gpu');
        assert.ok(r.stdout.includes('--no-sandbox'), 'private Helpers should use the compatible process configuration');

        const runtimeDir = runtimeAppDir(launcher);
        const runtimePkgJsonPath = path.join(runtimeDir, 'Contents', 'Resources', 'app', 'package.json');
        assert.ok(fs.existsSync(runtimePkgJsonPath), 'private runtime copy should exist');

        const pkg = JSON.parse(fs.readFileSync(runtimePkgJsonPath, 'utf8'));
        assert.equal(pkg.main, './loadNapCat-qce.js', 'runtime copy\'s main should point at the generated loader');

        const loaderPath = path.join(path.dirname(runtimePkgJsonPath), 'loadNapCat-qce.js');
        assert.ok(fs.existsSync(loaderPath), 'loader script should be written next to the runtime copy\'s package.json');
        const loaderSource = fs.readFileSync(loaderPath, 'utf8');
        assert.ok(
            !loaderSource.includes("require('./application.asar/app_launcher/index.js')"),
            'opening the private bundle outside the launcher must never enter desktop QQ',
        );
        assert.ok(
            loaderSource.includes('QCE_NAPCAT_ENTRY'),
            'loader should gate on QCE_NAPCAT_ENTRY',
        );
        assert.ok(loaderSource.includes('app.exit(0)'), 'unsupported direct launch should exit cleanly');
        assert.ok(loaderSource.includes('getPluginExports'), 'cleanup must address the loaded plugin instance');
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: re-signs the runtime and all four Helpers without sandbox/inherit/app-groups', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-entitlements-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);

        const r = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });
        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);

        const runtimeDir = runtimeAppDir(launcher);
        const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', runtimeDir], { encoding: 'utf8' });
        assert.equal(verify.status, 0, `codesign --verify failed on the runtime copy: ${verify.stderr}`);

        assert.equal(fixture.helpers.length, 4);
        const runtimeHelpers = fixture.helpers.map(helper =>
            path.join(runtimeDir, path.relative(fixture.appDir, helper.appDir)));
        for (const appDir of [runtimeDir, ...runtimeHelpers]) {
            const entitlements = readEntitlements(appDir);
            for (const key of ['cs.allow-jit', 'cs.disable-library-validation']) {
                assert.ok(entitlements.includes(`com.apple.security.${key}`),
                    `${path.basename(appDir)} must allow ${key} for Electron / NapCat`);
            }
            for (const key of ['app-sandbox', 'inherit', 'application-groups']) {
                assert.ok(!entitlements.includes(`com.apple.security.${key}`),
                    `${path.basename(appDir)} must not retain ${key} on the ad-hoc runtime`);
            }
        }
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: re-running is idempotent (does not re-copy/re-patch an already-prepared runtime)', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-idempotent-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);
        const env = { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary };

        const first = runLauncher(launcher, env);
        assert.equal(first.status, 0, `first run exited non-zero: ${first.stderr}`);
        assert.ok(first.stdout.includes('Preparing a private'), `first run should prepare the runtime copy, got: ${first.stdout}`);

        const runtimeDir = runtimeAppDir(launcher);
        const loaderPath = path.join(runtimeDir, 'Contents', 'Resources', 'app', 'loadNapCat-qce.js');
        const loaderMtimeAfterFirst = fs.statSync(loaderPath).mtimeMs;

        const second = runLauncher(launcher, env);
        assert.equal(second.status, 0, `second run exited non-zero: ${second.stderr}`);
        assert.ok(!second.stdout.includes('Preparing a private'), `second run should skip re-preparing, got: ${second.stdout}`);
        assert.ok(second.stdout.includes('QQ_EXECED'), 'second run should still exec the runtime copy');

        assert.equal(
            fs.statSync(loaderPath).mtimeMs,
            loaderMtimeAfterFirst,
            'loader should not be rewritten when the runtime copy is already up to date',
        );
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: rejects a symlink to its own runtime without deleting or changing it', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-self-alias-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);
        const first = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });
        assert.equal(first.status, 0, `first run exited non-zero: ${first.stderr}`);

        const runtimeDir = runtimeAppDir(launcher);
        const runtimeFiles = [
            path.join(runtimeDir, 'Contents', 'MacOS', 'QQ'),
            path.join(runtimeDir, 'Contents', 'Resources', 'app', 'package.json'),
            path.join(runtimeDir, 'Contents', 'Resources', 'app', 'loadNapCat-qce.js'),
            ...fixture.helpers.map(helper => path.join(runtimeDir, path.relative(fixture.appDir, helper.binary))),
            path.join(tmp.path, '.qce-runtime-source-version'),
            path.join(tmp.path, '.qce-runtime-patch-version'),
        ];
        const before = runtimeFiles.map(file => fs.readFileSync(file));
        const alias = path.join(tmp.path, 'runtime-alias.app');
        fs.symlinkSync(runtimeDir, alias, 'dir');

        const second = runLauncher(launcher, {
            ...process.env,
            NAPCAT_QQ_PATH: path.join(alias, 'Contents', 'MacOS', 'QQ'),
        });
        assert.equal(second.status, 1, 'an aliased runtime must be rejected as a source');
        assert.match(second.stdout, /points at QCE's own runtime copy/);
        for (const [index, file] of runtimeFiles.entries()) {
            assert.ok(before[index].equals(fs.readFileSync(file)), `self-reference must leave ${file} unchanged`);
        }
        assert.ok(fixture.pristineBytes.equals(fs.readFileSync(fixture.qqBinary)),
            'original QQ fixture must still be unchanged');
        const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', runtimeDir], { encoding: 'utf8' });
        assert.equal(verify.status, 0, `rejected source must leave a valid runtime: ${verify.stderr}`);
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: links the desktop client message store into the unsandboxed location', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-datastore-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);

        // Stand in for the desktop client's sandboxed store: one per-account
        // directory holding a database the runtime copy must be able to read.
        const store = path.join(containerStoreDir(tmp.path), 'nt_qq_deadbeef');
        fs.mkdirSync(path.join(store, 'nt_db'), { recursive: true });
        fs.writeFileSync(path.join(store, 'nt_db', 'buddy_msg_fts.db'), 'real history');

        const r = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });
        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);

        const link = path.join(liveStoreDir(tmp.path), 'nt_qq_deadbeef');
        assert.ok(fs.lstatSync(link).isSymbolicLink(), 'per-account store should be symlinked, not copied');
        assert.equal(fs.readlinkSync(link), store);
        assert.equal(
            fs.readFileSync(path.join(link, 'nt_db', 'buddy_msg_fts.db'), 'utf8'),
            'real history',
            'the runtime copy must read through to the desktop client\'s database',
        );
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: moves a previously separate store aside instead of deleting it', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-datastore-migrate-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);

        const store = path.join(containerStoreDir(tmp.path), 'nt_qq_deadbeef');
        fs.mkdirSync(store, { recursive: true });
        fs.writeFileSync(path.join(store, 'marker'), 'container');

        // What an earlier QCE release left behind: the copy's own empty store.
        const stale = path.join(liveStoreDir(tmp.path), 'nt_qq_deadbeef');
        fs.mkdirSync(stale, { recursive: true });
        fs.writeFileSync(path.join(stale, 'marker'), 'stale');

        const r = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });
        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);

        assert.ok(fs.lstatSync(stale).isSymbolicLink(), 'stale store should have been replaced by a symlink');
        assert.equal(
            fs.readFileSync(`${stale}.qce-unlinked-backup/marker`, 'utf8'),
            'stale',
            'the stale store must be preserved as a backup, never deleted',
        );
        assert.equal(
            fs.readFileSync(path.join(store, 'marker'), 'utf8'),
            'container',
            'nothing inside the sandbox container may be modified',
        );
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: refuses to start while the desktop QQ client is running', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-running-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);

        // A long-lived process whose command line carries the QQ binary path
        // is exactly what the launcher's pgrep -f keys on. `tail -f` is used
        // rather than a shell one-liner because /bin/sh exec-optimises simple
        // commands and would drop the path from its own argv.
        const holder = spawn('/usr/bin/tail', ['-f', fixture.qqBinary], { stdio: 'ignore' });
        try {
            const seen = waitForPgrep(fixture.qqBinary);
            assert.ok(seen, 'test setup: the stand-in process never became visible to pgrep');

            const r = runLauncher(launcher, { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary });
            assert.equal(r.status, 1, 'launcher should refuse to start');
            assert.match(r.stdout, /desktop QQ client is still running/);
            assert.ok(
                !fs.existsSync(runtimeAppDir(launcher)),
                'the ~1 GB copy must not run before the login-slot check',
            );
        } finally {
            holder.kill();
        }
    } finally {
        tmp.cleanup();
    }
});

test('macOS launcher: an upstream QQ update triggers a clean re-copy + re-patch', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-macos-reupdate-');
    try {
        const fixture = stageFakeQqApp(tmp.path);
        const launcher = stageLauncher(tmp.path);
        const env = { ...process.env, NAPCAT_QQ_PATH: fixture.qqBinary };

        const first = runLauncher(launcher, env);
        assert.equal(first.status, 0, `first run exited non-zero: ${first.stderr}`);

        // Simulate a QQ auto-update: the real install ships a fresh
        // package.json (still with its own pristine, unpatched entry — the
        // real QQ.app is never patched in the first place).
        fs.writeFileSync(
            fixture.packageJson,
            JSON.stringify(
                {
                    name: 'qq-chat',
                    version: '6.9.99-updated',
                    buildVersion: '00002',
                    main: './application.asar/app_launcher/index.js',
                },
                null,
                2,
            ),
        );

        const second = runLauncher(launcher, env);
        assert.equal(second.status, 0, `second run exited non-zero: ${second.stderr}`);
        assert.ok(second.stdout.includes('Preparing a private'), `post-update run should re-prepare, got: ${second.stdout}`);
        assert.ok(second.stdout.includes('QQ_EXECED'), 'should still exec the runtime copy after re-patching');

        const runtimeDir = runtimeAppDir(launcher);
        const pkg = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'Contents', 'Resources', 'app', 'package.json'), 'utf8'));
        assert.equal(pkg.main, './loadNapCat-qce.js');
    } finally {
        tmp.cleanup();
    }
});
