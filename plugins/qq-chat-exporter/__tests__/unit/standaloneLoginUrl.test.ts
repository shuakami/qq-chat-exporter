/**
 * Regression test for issue #457: standalone mode gave users no way to see
 * the access token, so the /auth page was an unpassable wall.
 *
 * The fix lives in the generated qce-standalone.mjs (scripts/quick-pack.py):
 * after spawning qce-server it polls security.json (QCE_CONFIG_DIR or
 * ~/.qq-chat-exporter) and prints the one-click login URL.
 *
 * The test extracts the embedded script from quick-pack.py, runs it against
 * a fake qce-server that writes security.json, and asserts the login URL is
 * printed with the URL-encoded token.
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
const QUICK_PACK = path.join(REPO_ROOT, 'scripts', 'quick-pack.py');

function extractStandaloneScript(): string {
    const source = fs.readFileSync(QUICK_PACK, 'utf8');
    const match = source.match(/standalone_mjs = '''([\s\S]*?)'''/);
    assert.ok(match, 'quick-pack.py should embed standalone_mjs');
    return match[1].replace(/\r\n/g, '\n');
}

const posixOnly = process.platform !== 'win32'
    ? null
    : 'fake qce-server is a POSIX shell script';

test('standalone script prints one-click login URL from security.json (issue #457)', { skip: posixOnly ?? false }, () => {
    const tmp = createTempDir('qce-standalone-457-');
    try {
        const packDir = path.join(tmp.path, 'pack');
        const configDir = path.join(tmp.path, 'config');
        fs.mkdirSync(packDir, { recursive: true });
        fs.mkdirSync(configDir, { recursive: true });

        fs.writeFileSync(path.join(packDir, 'qce-standalone.mjs'), extractStandaloneScript());

        // Fake qce-server: write security.json like SecurityManager does,
        // stay alive long enough for the poll loop to observe it.
        const token = 'abc123+/=TOKEN';
        const fakeServer = path.join(packDir, 'qce-server');
        fs.writeFileSync(
            fakeServer,
            `#!/bin/sh\ncat > "${configDir}/security.json" <<'EOF'\n{"accessToken":"${token}"}\nEOF\nsleep 3\n`,
            { mode: 0o755 },
        );

        const result = spawnSync(
            process.execPath,
            [path.join(packDir, 'qce-standalone.mjs'), '23456'],
            {
                env: { ...process.env, QCE_CONFIG_DIR: configDir },
                encoding: 'utf8',
                timeout: 30_000,
            },
        );

        assert.equal(result.status, 0, `stderr: ${result.stderr}`);
        assert.match(
            result.stdout,
            /\[QCE\] 一键登录: http:\/\/127\.0\.0\.1:23456\/qce\/auth\?token=/,
        );
        assert.ok(
            result.stdout.includes(`token=${encodeURIComponent(token)}`),
            `stdout should contain the URL-encoded token, got: ${result.stdout}`,
        );
    } finally {
        tmp.cleanup();
    }
});
