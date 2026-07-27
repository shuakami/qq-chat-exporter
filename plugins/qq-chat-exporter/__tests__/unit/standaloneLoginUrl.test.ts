/**
 * Regression test for issue #457: standalone mode gave users no way to see
 * the access token, so the /auth page was an unpassable wall.
 *
 * The fix lives in the generated qce-standalone.mjs (scripts/quick-pack.py):
 * once qce-server is listening it reads security.json (QCE_CONFIG_DIR or
 * ~/.qq-chat-exporter), prints the token plus a one-click login URL, and
 * opens that URL in a browser unless QCE_NO_AUTO_OPEN=1 — matching what full
 * mode does in plugins/qq-chat-exporter/runtime/rustBridge.mjs.
 *
 * Waiting for the port matters: security.json is written *before* qce-server
 * binds, so on any run after the first it already exists and announcing on
 * its presence alone would fire while nothing is listening yet.
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

/**
 * Reads the embedded script verbatim. This is only equivalent to what
 * quick-pack.py writes out because the literal is a *raw* Python string —
 * without the r prefix Python expands the \n escapes belonging to the
 * JavaScript and emits a file that does not parse. The regex therefore
 * requires the prefix rather than assuming it.
 */
function extractStandaloneScript(): string {
    const source = fs.readFileSync(QUICK_PACK, 'utf8');
    const match = source.match(/standalone_mjs = r'''([\s\S]*?)'''/);
    assert.ok(match, "quick-pack.py should embed standalone_mjs as a raw (r''') string");
    return match[1].replace(/\r\n/g, '\n');
}

const posixOnly = process.platform !== 'win32'
    ? null
    : 'fake qce-server is a POSIX shell script';

/**
 * Stands in for qce-server: writes security.json the way SecurityManager does,
 * then actually listens on QCE_SERVER_PORT. The listening part is load-bearing
 * — the script waits for the port before announcing anything, precisely so a
 * server that failed to bind cannot produce a login URL.
 */
function fakeServer(configDir: string, token: string): string {
    return `#!/bin/sh
cat > "${configDir}/security.json" <<'EOF'
{"accessToken":"${token}"}
EOF
exec "${process.execPath}" -e 'require("net").createServer().listen(Number(process.env.QCE_SERVER_PORT),"127.0.0.1",()=>setTimeout(()=>process.exit(0),3000))'
`;
}

test('standalone script prints one-click login URL from security.json (issue #457)', { skip: posixOnly ?? false }, () => {
    const tmp = createTempDir('qce-standalone-457-');
    try {
        const packDir = path.join(tmp.path, 'pack');
        const configDir = path.join(tmp.path, 'config');
        fs.mkdirSync(packDir, { recursive: true });
        fs.mkdirSync(configDir, { recursive: true });

        fs.writeFileSync(path.join(packDir, 'qce-standalone.mjs'), extractStandaloneScript());

        const token = 'abc123+/=TOKEN';
        fs.writeFileSync(path.join(packDir, 'qce-server'), fakeServer(configDir, token), { mode: 0o755 });

        const result = spawnSync(
            process.execPath,
            [path.join(packDir, 'qce-standalone.mjs'), '23456'],
            {
                env: { ...process.env, QCE_CONFIG_DIR: configDir, QCE_NO_AUTO_OPEN: '1' },
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
        assert.match(result.stdout, /\[QCE\] Token: /, 'the bare token is printed too, as in full mode');
    } finally {
        tmp.cleanup();
    }
});

test('standalone script stays quiet when the server never comes up', { skip: posixOnly ?? false }, () => {
    const tmp = createTempDir('qce-standalone-dead-');
    try {
        const packDir = path.join(tmp.path, 'pack');
        const configDir = path.join(tmp.path, 'config');
        fs.mkdirSync(packDir, { recursive: true });
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(packDir, 'qce-standalone.mjs'), extractStandaloneScript());

        // security.json already exists from an earlier run — the trap this
        // guards against. A server that dies on startup (port taken) must not
        // produce a "one-click login" line, let alone a browser tab pointing
        // at nothing.
        fs.writeFileSync(path.join(configDir, 'security.json'), JSON.stringify({ accessToken: 'stale' }));
        fs.writeFileSync(path.join(packDir, 'qce-server'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });

        const result = spawnSync(
            process.execPath,
            [path.join(packDir, 'qce-standalone.mjs'), '23457'],
            {
                env: { ...process.env, QCE_CONFIG_DIR: configDir, QCE_NO_AUTO_OPEN: '1' },
                encoding: 'utf8',
                timeout: 30_000,
            },
        );

        assert.equal(result.status, 1, 'the server exit code is propagated');
        assert.doesNotMatch(result.stdout, /一键登录/, `no login URL should be announced, got: ${result.stdout}`);
    } finally {
        tmp.cleanup();
    }
});
