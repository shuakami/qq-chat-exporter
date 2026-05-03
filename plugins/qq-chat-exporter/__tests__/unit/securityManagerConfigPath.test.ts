import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { SecurityManager } from '../../lib/security/SecurityManager.js';

function withEnv(
    env: Partial<Record<string, string | undefined>>,
    fn: () => void,
): void {
    const saved: Record<string, string | undefined> = {};
    try {
        for (const [k, v] of Object.entries(env)) {
            saved[k] = process.env[k];
            if (v === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = v;
            }
        }
        fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = v;
            }
        }
    }
}

test('resolveSecurityDir: QCE_CONFIG_DIR 优先于 USERPROFILE / HOME', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-cfg-'));
    try {
        withEnv(
            {
                QCE_CONFIG_DIR: tmp,
                USERPROFILE: '/should/not/use',
                HOME: '/should/not/use/either',
            },
            () => {
                assert.equal(SecurityManager.resolveSecurityDir(), tmp);
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('resolveSecurityDir: 没有覆盖时回退到 ~/.qq-chat-exporter', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-home-'));
    try {
        withEnv(
            {
                QCE_CONFIG_DIR: undefined,
                USERPROFILE: undefined,
                HOME: tmp,
                HOMEDRIVE: undefined,
                HOMEPATH: undefined,
            },
            () => {
                assert.equal(
                    SecurityManager.resolveSecurityDir(),
                    path.join(tmp, '.qq-chat-exporter'),
                );
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('resolveSecurityDir: USERPROFILE 落到 system32 时回退到 HOMEDRIVE+HOMEPATH（issue #272）', () => {
    withEnv(
        {
            QCE_CONFIG_DIR: undefined,
            USERPROFILE: 'C:\\Windows\\system32\\config\\systemprofile',
            HOME: undefined,
            HOMEDRIVE: 'D:',
            HOMEPATH: '\\Users\\real-user',
        },
        () => {
            const dir = SecurityManager.resolveSecurityDir();
            // 不应再用 system32 的 USERPROFILE
            assert.ok(
                !dir.toLowerCase().includes('system32'),
                `不应回退到 system32: ${dir}`,
            );
            // 应能拼到 HOMEDRIVE+HOMEPATH 下
            assert.ok(
                dir.replace(/\\/g, '/').toLowerCase().includes('users/real-user/.qq-chat-exporter'),
                `应使用 HOMEDRIVE+HOMEPATH: ${dir}`,
            );
        },
    );
});

test('resolveSecurityDir: USERPROFILE / HOMEPATH 都在 system32 下时退到 cwd', () => {
    withEnv(
        {
            QCE_CONFIG_DIR: undefined,
            USERPROFILE: 'C:\\Windows\\system32\\config\\systemprofile',
            HOME: undefined,
            HOMEDRIVE: 'C:',
            HOMEPATH: '\\Windows\\system32',
        },
        () => {
            const dir = SecurityManager.resolveSecurityDir();
            assert.ok(
                !dir.toLowerCase().includes('system32'),
                `不应使用任何 system32 候选: ${dir}`,
            );
            assert.ok(dir.endsWith('.qq-chat-exporter'));
        },
    );
});

test('resolveSecurityDir: QCE_CONFIG_DIR 为空白字符串时不被采用', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-empty-'));
    try {
        withEnv(
            {
                QCE_CONFIG_DIR: '   ',
                USERPROFILE: tmp,
                HOME: undefined,
                HOMEDRIVE: undefined,
                HOMEPATH: undefined,
            },
            () => {
                assert.equal(
                    SecurityManager.resolveSecurityDir(),
                    path.join(tmp, '.qq-chat-exporter'),
                );
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('SecurityManager 构造函数会用 QCE_CONFIG_DIR 而不是 system32', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-mgr-'));
    try {
        withEnv(
            {
                QCE_CONFIG_DIR: tmp,
            },
            () => {
                const mgr = new SecurityManager();
                const cfgPath = mgr.getConfigPath();
                assert.equal(path.dirname(cfgPath), tmp);
                assert.equal(path.basename(cfgPath), 'security.json');
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('initialize() 写出的 token 仅包含 A-Z / a-z / 0-9（issue #272）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-token-'));
    try {
        await withEnvAsync({ QCE_CONFIG_DIR: tmp }, async () => {
            const mgr = new SecurityManager();
            await mgr.initialize();

            const token = mgr.getAccessToken();
            assert.ok(token, 'token 应已生成');
            assert.match(token!, /^[A-Za-z0-9]+$/, `token 含非字母数字: ${token}`);
            assert.ok(
                token!.length >= 32,
                `token 长度不应缩水 (got ${token!.length})`,
            );

            mgr.stopConfigWatcher();
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

async function withEnvAsync(
    env: Partial<Record<string, string | undefined>>,
    fn: () => Promise<void>,
): Promise<void> {
    const saved: Record<string, string | undefined> = {};
    try {
        for (const [k, v] of Object.entries(env)) {
            saved[k] = process.env[k];
            if (v === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = v;
            }
        }
        await fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = v;
            }
        }
    }
}
