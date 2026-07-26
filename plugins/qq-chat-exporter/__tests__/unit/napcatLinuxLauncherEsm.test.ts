/**
 * Regression coverage for QQNT 3.2.29's ESM package scope (issue #499).
 *
 * The Linux LD_PRELOAD shim writes loadNapCat.js as QQ's replacement entry
 * point. Newer QQ packages may mark .js files as ESM, so that bootstrap must
 * not rely on CommonJS-only globals such as require or __filename.
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
const BUILD_SH = path.join(LAUNCHER_DIR, 'build.sh');

function hasGpp(): boolean {
    return spawnSync('g++', ['--version'], { stdio: 'ignore' }).status === 0;
}

const skipReason = process.platform !== 'linux'
    ? 'napcat-launcher is Linux-only'
    : !hasGpp()
        ? 'g++ not available'
        : !fs.existsSync(BUILD_SH)
            ? 'napcat-launcher build.sh not present'
            : null;

test('napcat-launcher: generated bootstrap runs inside an ESM package scope', { skip: skipReason ?? false }, () => {
    const tmp = createTempDir('napcat-launcher-esm-');
    try {
        const shim = path.join(tmp.path, 'libnapcat_launcher.so');
        execFileSync(BUILD_SH, [shim], {
            cwd: tmp.path,
            stdio: ['ignore', 'ignore', 'pipe'],
        });

        // Loading the shim runs its constructor and writes the disk fallback
        // loadNapCat.js into the current working directory.
        const generate = spawnSync('true', [], {
            cwd: tmp.path,
            env: {
                ...process.env,
                LD_PRELOAD: shim,
                NAPCAT_BOOTMAIN: tmp.path,
                NAPCAT_LAUNCHER_DEBUG: '0',
            },
            encoding: 'utf8',
        });
        assert.equal(generate.status, 0, `shim constructor failed: ${generate.stderr}`);

        const bootstrap = path.join(tmp.path, 'loadNapCat.js');
        assert.ok(fs.existsSync(bootstrap), 'shim should generate loadNapCat.js');

        // Reproduce QQNT 3.2.29: .js files in this package are interpreted as
        // ES modules. The generated entry must still import napcat.mjs.
        fs.writeFileSync(
            path.join(tmp.path, 'package.json'),
            JSON.stringify({ name: 'qq-esm-scope', type: 'module' }),
        );
        fs.writeFileSync(
            path.join(tmp.path, 'napcat.mjs'),
            "import fs from 'node:fs';\nfs.writeFileSync(new URL('./esm-bootstrap-ran.txt', import.meta.url), 'ok');\n",
        );

        const run = spawnSync(process.execPath, [bootstrap], {
            cwd: tmp.path,
            env: {
                ...process.env,
                NAPCAT_BOOTMAIN: tmp.path,
            },
            encoding: 'utf8',
        });

        assert.equal(run.status, 0, `ESM bootstrap failed: ${run.stderr}`);
        assert.equal(
            fs.readFileSync(path.join(tmp.path, 'esm-bootstrap-ran.txt'), 'utf8'),
            'ok',
        );
    } finally {
        tmp.cleanup();
    }
});
