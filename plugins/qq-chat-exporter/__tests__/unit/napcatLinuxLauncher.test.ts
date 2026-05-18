/**
 * Sanity tests for the LD_PRELOAD launcher shim that backs the Linux flow
 * (see scripts/napcat-launcher/launcher.cpp, issue #433).
 *
 * The shim is the load-bearing piece of the fix: it tells QQ Electron to
 * boot loadNapCat.js out of the QCE pack directory instead of QQ's own
 * app_launcher/index.js, so wrapper.node runs inside the Electron embedder
 * it was built for instead of plain Node.js (which segfaults on login).
 *
 * Tests:
 *   1. The .cpp builds with the project's build.sh.
 *   2. When LD_PRELOAD'd into `cat`, opening a fake `resources/app/package.json`
 *      returns a modified buffer with `main` rewritten to loadNapCat.js.
 *   3. Opening unrelated paths passes through unchanged.
 *
 * Skipped (not failed) when:
 *   - We're not on Linux (the shim is Linux-only).
 *   - g++ is unavailable (g++ is part of the standard build environment;
 *     skipping here just keeps `npm test` runnable on bare boxes).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

import { createTempDir } from '../helpers/tempDir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LAUNCHER_DIR = path.join(REPO_ROOT, 'scripts', 'napcat-launcher');
const LAUNCHER_CPP = path.join(LAUNCHER_DIR, 'launcher.cpp');
const BUILD_SH = path.join(LAUNCHER_DIR, 'build.sh');

function hasGpp(): boolean {
    const r = spawnSync('g++', ['--version'], { stdio: 'ignore' });
    return r.status === 0;
}

const linuxOnly = process.platform === 'linux';
const skipReason = !linuxOnly
    ? 'napcat-launcher is Linux-only'
    : !hasGpp()
        ? 'g++ not available'
        : !fs.existsSync(LAUNCHER_CPP)
            ? 'launcher.cpp not present'
            : null;

test('napcat-launcher: sources are present', () => {
    assert.ok(fs.existsSync(LAUNCHER_CPP), `${LAUNCHER_CPP} should exist`);
    assert.ok(fs.existsSync(BUILD_SH), `${BUILD_SH} should exist`);
});

test('napcat-launcher: build.sh produces a loadable .so', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('napcat-launcher-build-');
    try {
        const out = path.join(tmp.path, 'libnapcat_launcher.so');
        execFileSync(BUILD_SH, [out], {
            cwd: tmp.path,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        const stat = fs.statSync(out);
        assert.ok(stat.size > 0, 'built .so should be non-empty');
    } finally {
        tmp.cleanup();
    }
});

test('napcat-launcher: package.json main field is rewritten under LD_PRELOAD', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('napcat-launcher-hook-');
    try {
        // 1. Build the shim.
        const so = path.join(tmp.path, 'libnapcat_launcher.so');
        execFileSync(BUILD_SH, [so], {
            cwd: tmp.path,
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        // 2. Lay down a fake QQ install with the asar-style main field.
        const qqRoot = path.join(tmp.path, 'fakeqq', 'resources', 'app');
        fs.mkdirSync(qqRoot, { recursive: true });
        const fakePkgJson = path.join(qqRoot, 'package.json');
        fs.writeFileSync(
            fakePkgJson,
            JSON.stringify(
                {
                    name: 'qq',
                    version: '3.2.28-48517',
                    main: './application.asar/app_launcher/index.js',
                },
                null,
                2,
            ),
        );

        // 3. Spawn `cat` against a *suffix-matching* path so the hook fires,
        //    and point NAPCAT_QQ_PKG_JSON at the real file so the shim
        //    actually has bytes to patch.
        const suffixPath = path.join(qqRoot, 'package.json'); // ends in resources/app/package.json
        const cwdForLauncher = tmp.path;

        const r = spawnSync('cat', [suffixPath], {
            cwd: cwdForLauncher,
            env: {
                ...process.env,
                LD_PRELOAD: so,
                NAPCAT_QQ_PKG_JSON: fakePkgJson,
                NAPCAT_LAUNCHER_DEBUG: '0',
            },
            encoding: 'utf8',
        });

        assert.equal(r.status, 0, `cat exited non-zero: ${r.stderr}`);
        const out = r.stdout;
        assert.ok(
            !out.includes('./application.asar/app_launcher/index.js'),
            'original asar main should be replaced',
        );
        assert.ok(
            out.includes('loadNapCat.js'),
            `rewritten main should reference loadNapCat.js, got: ${out}`,
        );
    } finally {
        tmp.cleanup();
    }
});

test('napcat-launcher: unrelated paths are passed through unchanged', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('napcat-launcher-passthrough-');
    try {
        const so = path.join(tmp.path, 'libnapcat_launcher.so');
        execFileSync(BUILD_SH, [so], {
            cwd: tmp.path,
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        const otherFile = path.join(tmp.path, 'unrelated.txt');
        const payload = 'pristine bytes; should not be intercepted';
        fs.writeFileSync(otherFile, payload);

        const r = spawnSync('cat', [otherFile], {
            cwd: tmp.path,
            env: {
                ...process.env,
                LD_PRELOAD: so,
                NAPCAT_LAUNCHER_DEBUG: '0',
            },
            encoding: 'utf8',
        });

        assert.equal(r.status, 0, `cat exited non-zero: ${r.stderr}`);
        assert.equal(r.stdout, payload);
    } finally {
        tmp.cleanup();
    }
});

test('napcat-launcher: plain (non-asar) main is also rewritten', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('napcat-launcher-plain-');
    try {
        const so = path.join(tmp.path, 'libnapcat_launcher.so');
        execFileSync(BUILD_SH, [so], {
            cwd: tmp.path,
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        const qqRoot = path.join(tmp.path, 'fakeqq', 'resources', 'app');
        fs.mkdirSync(qqRoot, { recursive: true });
        const fakePkgJson = path.join(qqRoot, 'package.json');
        // The launcher matches the canonical formatting QQ ships
        // (`"main": "..."`, with a space after the colon). QQNT's
        // package.json has historically used this layout; we mirror it in
        // the fixture so the test exercises the exact bytes the shim sees
        // on a real install.
        fs.writeFileSync(
            fakePkgJson,
            JSON.stringify(
                {
                    name: 'qq',
                    main: './application/app_launcher/index.js',
                },
                null,
                2,
            ),
        );

        const r = spawnSync('cat', [fakePkgJson], {
            cwd: tmp.path,
            env: {
                ...process.env,
                LD_PRELOAD: so,
                NAPCAT_QQ_PKG_JSON: fakePkgJson,
                NAPCAT_LAUNCHER_DEBUG: '0',
            },
            encoding: 'utf8',
        });

        assert.equal(r.status, 0, `cat exited non-zero: ${r.stderr}`);
        assert.ok(
            !r.stdout.includes('./application/app_launcher/index.js'),
            'plain (non-asar) main should be replaced',
        );
        assert.ok(r.stdout.includes('loadNapCat.js'));
    } finally {
        tmp.cleanup();
    }
});
