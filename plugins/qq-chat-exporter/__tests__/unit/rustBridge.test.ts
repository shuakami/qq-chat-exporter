import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    bridgeJsonReplacer,
    buildAuthUrl,
    buildBrowserOpenCommand,
    createNapCatBridge,
    readAccessTokenWithRetry,
    readAutoOpenBrowserSetting,
    resolveSecurityConfigPath,
    resolveUserConfigPath,
    shouldAutoOpenBrowser,
    startRustApiServer
} from '../../runtime/rustBridge.mjs';

import { createTempDir } from '../helpers/tempDir.js';

async function freePort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return address.port;
}

test('bridge JSON preserves nested Map, Set and bigint values', () => {
    const serialized = JSON.stringify({
        infos: new Map([['u_1', { uin: 10001n }]]),
        roles: new Set(['owner', 'admin'])
    }, bridgeJsonReplacer);
    assert.deepEqual(JSON.parse(serialized), {
        infos: { u_1: { uin: '10001' } },
        roles: ['owner', 'admin']
    });
});

test('bridge exposes raw NapCat services with the original arguments', async () => {
    const calls: unknown[][] = [];
    const groupCalls: unknown[][] = [];
    const core = {
        context: {
            session: {
                getMsgService: () => ({
                    fetchFavEmojiList: async (...args: unknown[]) => {
                        calls.push(args);
                        return {
                            emojiInfoList: new Map([
                                ['emoji_1', { eId: 'emoji_1', emoId: 1 }]
                            ])
                        };
                    }
                }),
                getGroupService: () => ({
                    getAllMemberList: async (...args: unknown[]) => {
                        groupCalls.push(args);
                        return {
                            result: {
                                infos: new Map([
                                    ['u_1', { uin: '10001', nick: 'one' }]
                                ])
                            }
                        };
                    }
                })
            }
        },
        apis: {}
    };
    const port = await freePort();
    const bridge = await createNapCatBridge(core, port);
    try {
        const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'MsgService.fetchFavEmojiList',
                params: ['', 1000, true, true]
            })
        });
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.deepEqual(calls, [['', 1000, true, true]]);
        assert.deepEqual(body.result.emojiInfoList, {
            emoji_1: { eId: 'emoji_1', emoId: 1 }
        });

        const groupResponse = await fetch(`http://127.0.0.1:${port}/rpc`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                method: 'GroupService.getAllMemberList',
                params: ['960420904', true]
            })
        });
        const groupBody = await groupResponse.json();
        assert.equal(groupBody.ok, true);
        assert.deepEqual(groupCalls, [['960420904', true]]);
        assert.deepEqual(groupBody.result.result.infos, {
            u_1: { uin: '10001', nick: 'one' }
        });
    } finally {
        await bridge.stop();
    }
});


test('qce-server spawn failures are written to the configured runtime log', async () => {
    const tmp = createTempDir('rust-bridge-log-');
    const binary = path.join(tmp.path, process.platform === 'win32' ? 'qce-server.exe' : 'qce-server');
    const logFile = path.join(tmp.path, 'logs', 'qce-runtime.log');
    fs.writeFileSync(binary, 'not an executable');
    const previousBinary = process.env.QCE_RUST_SERVER_PATH;
    const previousLogFile = process.env.QCE_LOG_FILE;
    process.env.QCE_RUST_SERVER_PATH = binary;
    process.env.QCE_LOG_FILE = logFile;
    const core = {
        context: {
            logger: {
                log() {},
                logError() {}
            }
        }
    };

    try {
        await assert.rejects(() => startRustApiServer(core, undefined));
        const log = fs.readFileSync(logFile, 'utf8');
        assert.ok(log.includes('[qce-plugin] starting qce-server'));
        assert.match(log, /\[qce-plugin\] (process error|startup failed|bridge startup failed|qce-server exited)/);
    } finally {
        if (previousBinary === undefined) delete process.env.QCE_RUST_SERVER_PATH;
        else process.env.QCE_RUST_SERVER_PATH = previousBinary;
        if (previousLogFile === undefined) delete process.env.QCE_LOG_FILE;
        else process.env.QCE_LOG_FILE = previousLogFile;
        tmp.cleanup();
    }
});

test('buildAuthUrl builds a one-click login link with the token URL-encoded', () => {
    assert.equal(
        buildAuthUrl(40653, 'abc123'),
        'http://127.0.0.1:40653/qce/auth?token=abc123'
    );
    // Tokens are opaque strings; nothing guarantees they never contain
    // URL-hostile characters, so this must not be a bare string interpolation.
    assert.equal(
        buildAuthUrl(40653, 'a+b/c=&d'),
        'http://127.0.0.1:40653/qce/auth?token=a%2Bb%2Fc%3D%26d'
    );
});

test('buildBrowserOpenCommand picks the right opener per platform', () => {
    const url = 'http://localhost:40653/qce/auth?token=abc';
    assert.deepEqual(buildBrowserOpenCommand(url, 'darwin'), { cmd: 'open', args: [url] });
    assert.deepEqual(buildBrowserOpenCommand(url, 'linux'), { cmd: 'xdg-open', args: [url] });
    assert.deepEqual(buildBrowserOpenCommand(url, 'win32'), { cmd: 'cmd', args: ['/c', 'start', '', url] });
});

test('QCE_NO_AUTO_OPEN=1 is a hard opt-out, independent of the persisted setting', () => {
    const tmp = createTempDir('rust-bridge-no-auto-open-');
    try {
        // A path that never exists: readAutoOpenBrowserSetting() falls back to
        // its own default (true), so this isolates the env-var override from
        // whatever the persisted setting resolves to.
        const missingConfigPath = path.join(tmp.path, 'user-config.json');
        assert.equal(shouldAutoOpenBrowser({}, missingConfigPath), true, 'unset + no config means open, as documented');
        assert.equal(shouldAutoOpenBrowser({ QCE_NO_AUTO_OPEN: '1' }, missingConfigPath), false);
        // docs/macos-deploy.md documents the value as exactly "1"; anything else
        // must not silently disable the tab.
        assert.equal(shouldAutoOpenBrowser({ QCE_NO_AUTO_OPEN: '0' }, missingConfigPath), true);
        assert.equal(shouldAutoOpenBrowser({ QCE_NO_AUTO_OPEN: '' }, missingConfigPath), true);

        // The env var wins even when the settings-page toggle says "open".
        fs.writeFileSync(missingConfigPath, JSON.stringify({ autoOpenBrowser: true }));
        assert.equal(shouldAutoOpenBrowser({ QCE_NO_AUTO_OPEN: '1' }, missingConfigPath), false);
    } finally {
        tmp.cleanup();
    }
});

test('shouldAutoOpenBrowser follows the settings-page toggle when the env var is unset', () => {
    const tmp = createTempDir('rust-bridge-persisted-toggle-');
    try {
        const configPath = path.join(tmp.path, 'user-config.json');
        fs.writeFileSync(configPath, JSON.stringify({ autoOpenBrowser: false }));
        assert.equal(shouldAutoOpenBrowser({}, configPath), false, 'settings-page "off" is honored');

        fs.writeFileSync(configPath, JSON.stringify({ autoOpenBrowser: true }));
        assert.equal(shouldAutoOpenBrowser({}, configPath), true);
    } finally {
        tmp.cleanup();
    }
});

test('readAutoOpenBrowserSetting defaults to true on missing file, bad JSON, or wrong type', () => {
    const tmp = createTempDir('rust-bridge-auto-open-setting-');
    try {
        const missing = path.join(tmp.path, 'does-not-exist.json');
        assert.equal(readAutoOpenBrowserSetting(missing), true);

        const badJson = path.join(tmp.path, 'bad.json');
        fs.writeFileSync(badJson, '{not valid json');
        assert.equal(readAutoOpenBrowserSetting(badJson), true);

        const wrongType = path.join(tmp.path, 'wrong-type.json');
        fs.writeFileSync(wrongType, JSON.stringify({ autoOpenBrowser: 'yes' }));
        assert.equal(readAutoOpenBrowserSetting(wrongType), true, 'non-boolean values are ignored, not coerced');

        const explicitFalse = path.join(tmp.path, 'off.json');
        fs.writeFileSync(explicitFalse, JSON.stringify({ autoOpenBrowser: false }));
        assert.equal(readAutoOpenBrowserSetting(explicitFalse), false);
    } finally {
        tmp.cleanup();
    }
});

test('resolveUserConfigPath always uses the home dir, unlike resolveSecurityConfigPath', () => {
    // Matches qq-chat-export-server's PathManager::default_base_dir(), which
    // does not honor QCE_CONFIG_DIR — this must stay in lockstep with that or
    // the settings-page toggle and the launcher read two different files.
    const previous = process.env.QCE_CONFIG_DIR;
    try {
        process.env.QCE_CONFIG_DIR = '/tmp/qce-config-override';
        assert.equal(
            resolveUserConfigPath(),
            path.join(os.homedir(), '.qq-chat-exporter', 'user-config.json')
        );
    } finally {
        if (previous === undefined) delete process.env.QCE_CONFIG_DIR;
        else process.env.QCE_CONFIG_DIR = previous;
    }
});

test('resolveSecurityConfigPath prefers QCE_CONFIG_DIR, falls back to the home dir', () => {
    const previous = process.env.QCE_CONFIG_DIR;
    try {
        process.env.QCE_CONFIG_DIR = '/tmp/qce-config-override';
        assert.equal(
            resolveSecurityConfigPath(),
            path.join('/tmp/qce-config-override', 'security.json')
        );

        delete process.env.QCE_CONFIG_DIR;
        assert.equal(
            resolveSecurityConfigPath(),
            path.join(os.homedir(), '.qq-chat-exporter', 'security.json')
        );
    } finally {
        if (previous === undefined) delete process.env.QCE_CONFIG_DIR;
        else process.env.QCE_CONFIG_DIR = previous;
    }
});

test('readAccessTokenWithRetry picks up a token that appears after a short delay', async () => {
    const tmp = createTempDir('rust-bridge-token-');
    const configPath = path.join(tmp.path, 'security.json');
    try {
        setTimeout(() => {
            fs.writeFileSync(configPath, JSON.stringify({ accessToken: 'late-token' }));
        }, 20);

        const token = await readAccessTokenWithRetry(configPath, { retries: 5, delayMs: 10 });
        assert.equal(token, 'late-token');
    } finally {
        tmp.cleanup();
    }
});

test('readAccessTokenWithRetry gives up and returns null if the file never appears', async () => {
    const tmp = createTempDir('rust-bridge-token-missing-');
    const configPath = path.join(tmp.path, 'security.json');
    try {
        const token = await readAccessTokenWithRetry(configPath, { retries: 2, delayMs: 5 });
        assert.equal(token, null);
    } finally {
        tmp.cleanup();
    }
});
