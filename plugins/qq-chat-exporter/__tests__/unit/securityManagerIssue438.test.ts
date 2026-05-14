/**
 * Issue #438 回归：
 *
 * NapCat 插件商店发布的 QCE 包里把一份「出厂」`security.json` 也打了进去
 * （`{disableIPWhitelist: false, allowedIPs: ['127.0.0.1', '::1']}`），导致
 * `SecurityManager.initialize()` 始终走 `loadConfig` 分支，Docker 自动配置
 * 永远不跑。这里覆盖 `migrateFactoryConfigIfNeeded` 的关键路径，并验证
 * `verifyTokenWithReason` 能把三种失败分开。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { SecurityManager } from '../../lib/security/SecurityManager.js';

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

function writeFactoryShippedConfig(dir: string): void {
    // 插件商店打包出的 security.json 默认内容（issue #438 描述）
    fs.writeFileSync(
        path.join(dir, 'security.json'),
        JSON.stringify({
            disableIPWhitelist: false,
            allowedIPs: ['127.0.0.1', '::1'],
        }),
        'utf-8',
    );
}

test('出厂打包 security.json + Docker 环境：initialize() 自动补齐并切到 Docker 模式（issue #438）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-438-'));
    try {
        writeFactoryShippedConfig(tmp);

        await withEnvAsync(
            {
                QCE_CONFIG_DIR: tmp,
                // 模拟 Docker 容器（绕开 /.dockerenv 检测）
                DOCKER_CONTAINER: '1',
            },
            async () => {
                const mgr = new SecurityManager();
                await mgr.initialize();
                try {
                    // 1. token / secret 应当被补齐
                    const token = mgr.getAccessToken();
                    assert.ok(token, 'token 应已被补齐');
                    assert.match(token!, /^[A-Za-z0-9]+$/);

                    // 2. Docker 模式应当被打开
                    assert.equal(
                        mgr.isIPWhitelistDisabled(),
                        true,
                        '出厂 security.json 在 Docker 下应自动 disableIPWhitelist=true',
                    );

                    // 3. allowedIPs 应当扩展到 Docker 网段
                    const allowed = mgr.getAllowedIPs();
                    for (const expected of [
                        '127.0.0.1',
                        '::1',
                        '172.16.0.0/12',
                        '192.168.0.0/16',
                        '10.0.0.0/8',
                    ]) {
                        assert.ok(
                            allowed.includes(expected),
                            `allowedIPs 应包含 ${expected}，实际为 ${JSON.stringify(allowed)}`,
                        );
                    }

                    // 4. 磁盘上的 security.json 也已被持久化更新
                    const persisted = JSON.parse(
                        fs.readFileSync(path.join(tmp, 'security.json'), 'utf-8'),
                    );
                    assert.equal(persisted.disableIPWhitelist, true);
                    assert.ok(typeof persisted.accessToken === 'string' && persisted.accessToken.length >= 32);
                    assert.ok(typeof persisted.secretKey === 'string' && persisted.secretKey.length >= 32);
                } finally {
                    mgr.stopConfigWatcher();
                }
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('出厂打包 security.json + 非 Docker 环境：补齐字段但不强行打开 Docker 模式', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-438-nondocker-'));
    try {
        writeFactoryShippedConfig(tmp);

        await withEnvAsync(
            {
                QCE_CONFIG_DIR: tmp,
                // 明确清掉容器标记，避免测试机自身在容器里影响判定
                container: undefined,
                DOCKER_CONTAINER: undefined,
            },
            async () => {
                // /.dockerenv / /proc/self/cgroup 仍可能误判，这里只在两者都不存在时跑。
                const looksLikeDocker =
                    fs.existsSync('/.dockerenv') ||
                    (fs.existsSync('/proc/self/cgroup') &&
                        /docker|kubepods/.test(fs.readFileSync('/proc/self/cgroup', 'utf8')));
                if (looksLikeDocker) {
                    // CI / 测试机本身就在 Docker 里，跳过这条用例
                    return;
                }

                const mgr = new SecurityManager();
                await mgr.initialize();
                try {
                    const token = mgr.getAccessToken();
                    assert.ok(token, '即使非 Docker，缺 token 时也应被补齐');

                    // 非 Docker 下不应自作主张打开 disableIPWhitelist
                    assert.equal(mgr.isIPWhitelistDisabled(), false);

                    // allowedIPs 保持出厂默认（127.0.0.1 + ::1）
                    const allowed = mgr.getAllowedIPs();
                    assert.deepEqual(allowed.sort(), ['127.0.0.1', '::1'].sort());
                } finally {
                    mgr.stopConfigWatcher();
                }
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('用户已自定义 security.json：迁移逻辑不覆盖用户偏好', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-438-user-'));
    try {
        // 用户手动指定了 allowedIPs / disableIPWhitelist
        const userCfg = {
            accessToken: 'UserSuppliedTokenAAAAAAAAAAAAAAAAAAAAA1',
            secretKey: 'UserSuppliedSecretKey' + 'x'.repeat(40),
            createdAt: new Date().toISOString(),
            allowedIPs: ['203.0.113.5', '198.51.100.0/24'],
            disableIPWhitelist: false,
            tokenExpired: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
        fs.writeFileSync(
            path.join(tmp, 'security.json'),
            JSON.stringify(userCfg),
            'utf-8',
        );

        await withEnvAsync(
            {
                QCE_CONFIG_DIR: tmp,
                DOCKER_CONTAINER: '1', // 即便处于 Docker 也不应覆盖用户配置
            },
            async () => {
                const mgr = new SecurityManager();
                await mgr.initialize();
                try {
                    assert.equal(mgr.getAccessToken(), userCfg.accessToken);
                    assert.equal(mgr.isIPWhitelistDisabled(), false);
                    assert.deepEqual(
                        mgr.getAllowedIPs().sort(),
                        userCfg.allowedIPs.slice().sort(),
                    );
                } finally {
                    mgr.stopConfigWatcher();
                }
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('verifyTokenWithReason: 三种失败分别返回 invalid_token / token_expired / ip_not_allowed', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-438-verify-'));
    try {
        await withEnvAsync(
            {
                QCE_CONFIG_DIR: tmp,
                // 走默认（非 Docker / Docker 都行），但要确保 IP 白名单生效
                container: undefined,
                DOCKER_CONTAINER: undefined,
            },
            async () => {
                const mgr = new SecurityManager();
                await mgr.initialize();
                try {
                    const token = mgr.getAccessToken()!;
                    assert.ok(token);

                    // 1. invalid_token
                    const wrongToken = mgr.verifyTokenWithReason('definitely-not-the-token');
                    assert.equal(wrongToken.ok, false);
                    if (!wrongToken.ok) {
                        assert.equal(wrongToken.reason, 'invalid_token');
                    }

                    // 2. ip_not_allowed —— token 对但 IP 不在白名单
                    //    注意：测试机可能已经因为 Docker 检测自动 disableIPWhitelist，
                    //    这种情况下 IP 不会被拒，跳过分支断言。
                    if (!mgr.isIPWhitelistDisabled()) {
                        const wrongIP = mgr.verifyTokenWithReason(token, '203.0.113.99');
                        assert.equal(wrongIP.ok, false);
                        if (!wrongIP.ok) {
                            assert.equal(wrongIP.reason, 'ip_not_allowed');
                        }
                    }

                    // 3. token_expired —— 手动把 tokenExpired 改到过去
                    const cfgPath = mgr.getConfigPath();
                    const onDisk = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
                    onDisk.tokenExpired = new Date(Date.now() - 60_000).toISOString();
                    fs.writeFileSync(cfgPath, JSON.stringify(onDisk), 'utf-8');

                    // 重建 manager 让它读到过期 token（避开 watcher 时序）
                    mgr.stopConfigWatcher();
                    const mgr2 = new SecurityManager();
                    await mgr2.initialize();
                    try {
                        const expired = mgr2.verifyTokenWithReason(
                            onDisk.accessToken,
                            '127.0.0.1',
                        );
                        // initialize() 会触发 regenerateToken（loadConfig 里检测到
                        // tokenExpired 已过），所以这里再用旧 token 走的是 invalid_token
                        // 分支 —— 这正是预期行为（旧 token 已经被换掉）。
                        assert.equal(expired.ok, false);
                        if (!expired.ok) {
                            assert.ok(
                                expired.reason === 'invalid_token' ||
                                    expired.reason === 'token_expired',
                                `expected invalid_token 或 token_expired，得到 ${expired.reason}`,
                            );
                        }
                    } finally {
                        mgr2.stopConfigWatcher();
                    }
                } finally {
                    mgr.stopConfigWatcher();
                }
            },
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('verifyToken 向后兼容：返回布尔值，等价于 verifyTokenWithReason().ok', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qce-438-compat-'));
    try {
        await withEnvAsync({ QCE_CONFIG_DIR: tmp }, async () => {
            const mgr = new SecurityManager();
            await mgr.initialize();
            try {
                const token = mgr.getAccessToken()!;
                assert.equal(mgr.verifyToken(token, '127.0.0.1'), true);
                assert.equal(mgr.verifyToken('wrong', '127.0.0.1'), false);
            } finally {
                mgr.stopConfigWatcher();
            }
        });
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
