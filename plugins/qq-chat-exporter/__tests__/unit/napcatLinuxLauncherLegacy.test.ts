/**
 * Tests for the launcher launch-mode switch (issue #469).
 *
 * From v5.5.64 the Linux flow drives the real QQ Electron binary, which shares
 * the desktop QQ client's PC-login slot so the two cannot stay online at once.
 * `--legacy` / `QCE_LINUX_LEGACY_LAUNCH=1` restores the pre-v5.5.64 standalone
 * Node.js launch (`node napcat-bootstrap.mjs`) that coexists with desktop QQ.
 *
 * These tests run the generated launcher (scripts/napcat-launcher/launcher-user.sh)
 * against a stubbed QQ binary and a stub `node`, and assert the launch mode is
 * selected correctly.
 *
 * Skipped (not failed) when:
 *   - We're not on Linux (the Electron branch is Linux-only).
 *   - bash is unavailable.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createTempDir } from '../helpers/tempDir.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LAUNCHER_SH = path.join(REPO_ROOT, 'scripts', 'napcat-launcher', 'launcher-user.sh');

function hasBash(): boolean {
    return spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0;
}

const skipReason = process.platform !== 'linux'
    ? 'launcher Electron branch is Linux-only'
    : !hasBash()
        ? 'bash not available'
        : !fs.existsSync(LAUNCHER_SH)
            ? 'launcher-user.sh not present'
            : null;

interface Stage {
    launcher: string;
    fakeQq: string;
    binDir: string;
}

/**
 * Lay down a self-contained launcher sandbox: the launcher script plus a stub
 * QQ binary and a stub `node` on PATH that each print an identifiable marker.
 */
function stage(tmpPath: string): Stage {
    const launcher = path.join(tmpPath, 'launcher-user.sh');
    fs.copyFileSync(LAUNCHER_SH, launcher);
    fs.chmodSync(launcher, 0o755);

    const fakeQq = path.join(tmpPath, 'fake-qq');
    fs.writeFileSync(fakeQq, '#!/bin/sh\necho ELECTRON_QQ_RAN "$@"\n');
    fs.chmodSync(fakeQq, 0o755);

    const binDir = path.join(tmpPath, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    const nodeStub = path.join(binDir, 'node');
    fs.writeFileSync(nodeStub, '#!/bin/sh\necho NODE_BOOTSTRAP_RAN "$@"\n');
    fs.chmodSync(nodeStub, 0o755);

    return { launcher, fakeQq, binDir };
}

function run(launcher: string, env: NodeJS.ProcessEnv, args: string[] = []) {
    return spawnSync('bash', [launcher, ...args], { env, encoding: 'utf8' });
}

test('launcher-user.sh: passes bash syntax check', { skip: skipReason ?? false }, () => {
    const r = spawnSync('bash', ['-n', LAUNCHER_SH], { encoding: 'utf8' });
    assert.equal(r.status, 0, `bash -n failed: ${r.stderr}`);
});

test('launcher: QCE_LINUX_LEGACY_LAUNCH=1 uses the Node bootstrap, not Electron', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-legacy-env-');
    try {
        const s = stage(tmp.path);
        const r = run(s.launcher, {
            ...process.env,
            PATH: `${s.binDir}:${process.env.PATH ?? ''}`,
            NAPCAT_QQ_PATH: s.fakeQq,
            QCE_LINUX_LEGACY_LAUNCH: '1',
            DISPLAY: ':0',
        });

        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);
        assert.ok(r.stdout.includes('Legacy launch mode enabled'), `expected legacy banner, got: ${r.stdout}`);
        assert.ok(r.stdout.includes('NODE_BOOTSTRAP_RAN'), 'should exec the node bootstrap stub');
        assert.ok(r.stdout.includes('napcat-bootstrap.mjs'), 'node bootstrap should target napcat-bootstrap.mjs');
        assert.ok(!r.stdout.includes('Linux Electron mode'), 'should not enter the Electron flow');
        assert.ok(!r.stdout.includes('ELECTRON_QQ_RAN'), 'should not exec the QQ Electron binary');
    } finally {
        tmp.cleanup();
    }
});

test('launcher: --legacy flag uses the Node bootstrap, not Electron', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-legacy-arg-');
    try {
        const s = stage(tmp.path);
        const r = run(s.launcher, {
            ...process.env,
            PATH: `${s.binDir}:${process.env.PATH ?? ''}`,
            NAPCAT_QQ_PATH: s.fakeQq,
            DISPLAY: ':0',
        }, ['--legacy']);

        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);
        assert.ok(r.stdout.includes('Legacy launch mode enabled'), `expected legacy banner, got: ${r.stdout}`);
        assert.ok(r.stdout.includes('NODE_BOOTSTRAP_RAN'), 'should exec the node bootstrap stub');
        assert.ok(!r.stdout.includes('ELECTRON_QQ_RAN'), 'should not exec the QQ Electron binary');
    } finally {
        tmp.cleanup();
    }
});

test('launcher: default Linux flow drives the QQ Electron binary', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('launcher-default-');
    try {
        const s = stage(tmp.path);
        // Pre-place the shared objects so the Electron branch skips its g++
        // compile steps and proceeds straight to exec'ing QQ.
        fs.writeFileSync(path.join(tmp.path, 'libnapcat_launcher.so'), '');
        fs.writeFileSync(path.join(tmp.path, 'qq_magic.so'), '');

        const r = run(s.launcher, {
            ...process.env,
            PATH: `${s.binDir}:${process.env.PATH ?? ''}`,
            NAPCAT_QQ_PATH: s.fakeQq,
            DISPLAY: ':0',
        });

        assert.equal(r.status, 0, `launcher exited non-zero: ${r.stderr}`);
        assert.ok(r.stdout.includes('Linux Electron mode'), `expected Electron banner, got: ${r.stdout}`);
        assert.ok(r.stdout.includes('ELECTRON_QQ_RAN'), 'should exec the QQ Electron binary');
        assert.ok(!r.stdout.includes('Legacy launch mode enabled'), 'should not announce legacy mode');
        assert.ok(!r.stdout.includes('NODE_BOOTSTRAP_RAN'), 'should not run the node bootstrap');
    } finally {
        tmp.cleanup();
    }
});
