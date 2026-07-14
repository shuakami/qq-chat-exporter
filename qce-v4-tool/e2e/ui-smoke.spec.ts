/**
 * UI smoke test - boots the auth page, drops a token and makes sure we land
 * on the main app shell. Skipped automatically when the frontend isn't
 * reachable so this can run in environments where only the API is up.
 *
 * To run these locally:
 *   1. `cd qce-v4-tool && pnpm build`
 *   2. `mkdir -p ../static && rm -rf ../static/qce && cp -r out ../static/qce`
 *   3. `cd ../plugins/qq-chat-exporter && pnpm mock:server`
 *   4. `cd ../../qce-v4-tool && E2E_FRONTEND_URL=http://localhost:40653 pnpm exec playwright test e2e/ui-smoke.spec.ts`
 *
 * The mock server serves the built frontend under `/qce/...` plus the
 * REST API on the same origin, which matches production routing far more
 * closely than `next dev` does.
 */

import { test, expect } from '@playwright/test';
import { isNewerVersion } from '../lib/version';

const TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';
const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://localhost:40653';
// Production URL has the frontend living under `/qce/`.
const AUTH_PATH = `/qce/auth`;
const SHELL_PATH = `/qce`;

async function clearLocalStorage(page: import('@playwright/test').Page) {
    // We can't use addInitScript here – that runs on EVERY navigation in the
    // page, so it would also wipe a token the auth flow just persisted.
    await page.goto(`${FRONTEND_BASE}${SHELL_PATH}`).catch(() => null);
    await page.evaluate(() => localStorage.clear()).catch(() => null);
}

test.describe('Auth flow', () => {

    test('home page loads', async ({ page }) => {
        const response = await page.goto(`${FRONTEND_BASE}${SHELL_PATH}`).catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );
        const title = await page.title();
        expect(title.length).toBeGreaterThan(0);
    });

    /**
     * Issue #287: the server prints a one-click login URL like
     * `…/qce/auth?token=<accessToken>`. The auth page should detect
     * that token, strip it from the URL bar (so history doesn't keep a copy),
     * verify it against the API, persist it to localStorage and forward the
     * user out of `/auth`.
     */
    test('one-click ?token=... strips the query string and persists the token', async ({ page }) => {
        await clearLocalStorage(page);
        const response = await page
            .goto(`${FRONTEND_BASE}${AUTH_PATH}?token=${TOKEN}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // `replaceState` should clear the `?token=` param before verification
        // resolves, so it never hangs around in browser history.
        await page.waitForFunction(() => !window.location.search.includes('token='), {
            timeout: 15_000
        });

        // After verification succeeds the auth page persists the token and
        // redirects out of /auth. Wait for the redirect to settle before
        // checking storage – the in-flight navigation otherwise nukes our
        // evaluate() context.
        await page.waitForURL(
            (url) => !url.pathname.endsWith('/auth') && !url.pathname.endsWith('/auth/'),
            { timeout: 15_000 }
        );

        const stored = await page.evaluate(() => localStorage.getItem('qce_access_token'));
        expect(stored).toBe(TOKEN);
    });

    /**
     * Bad URL token: mock API rejects, we fall back to the manual form so the
     * user can paste a fresh token from `security.json`. We must NOT redirect
     * and must NOT keep the bogus token in localStorage.
     */
    test('one-click flow falls back to manual form when token is rejected', async ({ page }) => {
        await clearLocalStorage(page);
        const response = await page
            .goto(`${FRONTEND_BASE}${AUTH_PATH}?token=definitely-wrong-token`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // Query string still gets stripped immediately on mount.
        await page.waitForFunction(() => !window.location.search.includes('token='), {
            timeout: 15_000
        });

        // Wait for the verification round-trip to finish; the page should
        // settle on the manual form without a redirect.
        await page.waitForTimeout(1500);
        const stored = await page.evaluate(() => localStorage.getItem('qce_access_token'));
        expect(stored).toBeNull();
        expect(new URL(page.url()).pathname).toMatch(/\/auth\/?$/);
    });

    /**
     * Codex P2 on PR #401: even when the user is already authenticated, the
     * auth page must scrub `?token=` from the URL before redirecting.
     * Otherwise the token-bearing URL stays in history / address bar
     * navigation when the user hits "back".
     */
    test('already-authenticated visit still strips ?token= from history', async ({ page }) => {
        // Pre-seed a valid token so the auth page hits the
        // `authManager.isAuthenticated()` branch.
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        const response = await page
            .goto(`${FRONTEND_BASE}${AUTH_PATH}?token=${TOKEN}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // The auth page's effect should run `replaceState` to strip the
        // ?token= query before kicking off the redirect.
        await page.waitForFunction(() => !window.location.search.includes('token='), {
            timeout: 15_000
        });

        // The URL the browser would record in history (after replaceState)
        // must no longer contain the token.
        expect(page.url()).not.toContain('token=');
    });
});

test.describe('Version updates', () => {
    test('compares prerelease and stable versions in release order', () => {
        expect(isNewerVersion('v6.0.0-beta.65', '6.0.0-beta.64')).toBe(true);
        expect(isNewerVersion('v6.0.0', '6.0.0-rc.2')).toBe(true);
        expect(isNewerVersion('v6.0.0-beta.66', '6.0.0')).toBe(false);
        expect(isNewerVersion('v6.0.1-beta.1', '6.0.0')).toBe(true);
        expect(isNewerVersion('latest', '6.0.0')).toBe(false);
    });

    test('shows a red help indicator and update entry for a newer release', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);
        await page.route(
            'https://api.github.com/repos/shuakami/qq-chat-exporter/releases?**',
            async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify([{
                        tag_name: 'v6.0.0',
                        html_url: 'https://github.com/shuakami/qq-chat-exporter/releases/tag/v6.0.0',
                    }]),
                });
            }
        );

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        const helpButton = page.getByRole('button', { name: '帮助，有新版本 v6.0.0' });
        await expect(helpButton).toBeVisible({ timeout: 15_000 });
        const skipBtn = page.getByRole('button', { name: '跳过' }).first();
        if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await skipBtn.click();
        }
        await helpButton.click();
        await expect(page.getByText('发现新版本', { exact: true })).toBeVisible();
        await expect(page.getByText('v6.0.0', { exact: true })).toBeVisible();
        await expect(page.getByText('查看更新内容', { exact: true })).toBeVisible();
    });
});

/**
 * Issue #204: 在搜索框里直接输入一个 4-12 位的 QQ 号，如果好友 / 群 / 最近联系人
 * 都搜不到，会话列表的空态会渲染「按 QQ 号反查」卡片，调用
 * `/api/users/lookup?uin=...`。Mock 服务器特地放了一条 uin=77777 的「已注销好友」
 * 会话，让这条链路完整跑起来。
 */
/**
 * 把主页带到「会话」标签页，并等到会话搜索框出现。
 *
 * 主页默认会打开 onboarding 弹窗（"欢迎使用…"）和 overview tab，会盖住测试要点
 * 的搜索框。这里统一处理：先把欢迎弹窗扫掉，再点侧栏的「会话」按钮，最后等真正
 * 的会话搜索 input 出现。
 */
async function openSessionsTab(page: import('@playwright/test').Page) {
    // 欢迎弹窗里的「跳过」按钮可见就关掉；不在则跳过。
    const skipBtn = page.getByRole('button', { name: '跳过' }).first();
    if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await skipBtn.click().catch(() => null);
    }
    // 侧栏的「会话」按钮（id=sessions）。用 role+name 精准定位避免和概览里的
    // 「浏览会话」按钮混淆。
    const sessionsTab = page.getByRole('button', { name: '会话', exact: true });
    await expect(sessionsTab).toBeVisible({ timeout: 15_000 });
    await sessionsTab.click();

    const searchBox = page.locator('input[placeholder*="搜索会话"]').first();
    await expect(searchBox).toBeVisible({ timeout: 15_000 });
    return searchBox;
}

test.describe('Session list — QQ lookup (issue #204)', () => {
    test('searching by deactivated QQ number reveals the lookup card', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        const searchBox = await openSessionsTab(page);

        // 输入一个 fixture 里没有任何文字 / id 命中、但 mock 后端能反查到的 uin。
        await searchBox.fill('77777');

        // 空态里应该出现 lookup 卡片标题。
        await expect(page.getByText('按 QQ 号反查会话')).toBeVisible({ timeout: 10_000 });

        // 卡片里有自己的输入框（已经被 initialUin 填上），点查询按钮触发后端调用。
        await page.getByRole('button', { name: /查询/ }).click();

        // 反查到 u_deactivated_77777，按钮区出现「导出」、徽章里写「非好友 / 已注销」。
        await expect(page.getByText('非好友 / 已注销')).toBeVisible({ timeout: 10_000 });
    });

    /**
     * Issue #363: 当本次导出有资源下载失败时，资源统计和 Rkey 降级说明
     * 都收进消息数旁的帮助 tooltip，不额外占用任务卡片空间。
     */
    test('completed task with failed resources shows summary details only in the tooltip (issue #363)', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        // 拦截 /api/tasks，让前端看到一条 issue #363 场景的完成任务。
        await page.route('**/api/tasks', async (route, request) => {
            // 只拦 GET，POST 走真接口（不影响其它流程）。
            if (request.method() !== 'GET') {
                await route.continue();
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        tasks: [
                            {
                                id: 'rkey-fallback-task',
                                peer: { peerUid: '12345', chatType: 1 },
                                sessionName: 'Rkey 降级测试会话',
                                status: 'completed',
                                progress: 100,
                                format: 'HTML',
                                messageCount: 200,
                                fileName: 'rkey_test.html',
                                filePath: '/tmp/rkey_test.html',
                                fileSize: 12345,
                                createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
                                completedAt: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
                                resourceSummary: {
                                    attempted: 12,
                                    alreadyAvailable: 3,
                                    downloaded: 5,
                                    failed: 4,
                                    skipped: 0,
                                    failedSamples: ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg', 'photo-4.jpg'],
                                },
                            },
                        ],
                    },
                }),
            });
        });

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // 关掉欢迎弹窗（如有），切到任务标签页。
        const skipBtn = page.getByRole('button', { name: '跳过' }).first();
        if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await skipBtn.click().catch(() => null);
        }
        const tasksTab = page.getByRole('button', { name: '任务', exact: true });
        await expect(tasksTab).toBeVisible({ timeout: 15_000 });
        await tasksTab.click();

        // 任务行出现
        await expect(page.getByText('Rkey 降级测试会话')).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/资源 8\/12，失败 4/)).toHaveCount(0);
        await expect(page.getByText(/Rkey 服务临时降级|重新打开相关消息/)).toHaveCount(0);
        const resourceHelp = page.getByRole('button', { name: '查看资源下载统计' });
        await expect(resourceHelp).toBeVisible();
        await resourceHelp.hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toContainText('资源 8/12，失败 4');
        await expect(tooltip).toContainText('QQ Rkey 服务临时不可用');
        const textWrap = await tooltip.evaluate((element) => getComputedStyle(element).textWrap);
        expect(textWrap).not.toContain('balance');
    });

    test('searching for a non-existent QQ shows a friendly not-found message', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        const searchBox = await openSessionsTab(page);
        await searchBox.fill('88888888');

        await expect(page.getByText('按 QQ 号反查会话')).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: /查询/ }).click();

        // mock 的 getUidByUinV2 对未登记 uin 返 undefined，落到 found=false。
        await expect(page.getByText(/未在本机 NTQQ 数据中找到/)).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('Sticker exports', () => {
    test('exporting keeps the loaded sticker list visible', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        let releaseExport!: () => void;
        const exportGate = new Promise<void>((resolve) => {
            releaseExport = resolve;
        });
        let markExportStarted!: () => void;
        const exportStarted = new Promise<void>((resolve) => {
            markExportStarted = resolve;
        });

        await page.route('**/api/sticker-packs**', async (route, request) => {
            const url = new URL(request.url());
            if (request.method() === 'GET' && url.pathname.endsWith('/export-records')) {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        data: { records: [], totalCount: 0 },
                    }),
                });
                return;
            }
            if (request.method() === 'GET') {
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        data: {
                            packs: [{
                                packId: 'regression-pack',
                                packName: '回归测试表情包',
                                packType: 'favorite_emoji',
                                stickerCount: 1,
                                stickers: [],
                            }],
                            stats: {
                                favorite_emoji: 1,
                                market_pack: 0,
                                system_pack: 0,
                            },
                            totalCount: 1,
                            totalStickers: 1,
                        },
                    }),
                });
                return;
            }
            if (request.method() === 'POST' && url.pathname.endsWith('/export')) {
                markExportStarted();
                await exportGate;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: true,
                        data: {
                            success: true,
                            packCount: 1,
                            stickerCount: 1,
                            exportPath: '/tmp/sticker-export',
                        },
                    }),
                });
                return;
            }
            await route.continue();
        });

        const response = await page
            .goto(`${FRONTEND_BASE}/qce/stickers`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        const packName = page.getByText('回归测试表情包', { exact: true });
        await expect(packName).toBeVisible({ timeout: 15_000 });
        const skipBtn = page.getByRole('button', { name: '跳过' }).first();
        if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await skipBtn.click();
        }
        const packRow = packName.locator('xpath=ancestor::div[contains(@class,"group")]');
        await packRow.hover();
        await packRow.getByRole('button', { name: '导出', exact: true }).click();
        await exportStarted;

        await expect(packName).toBeVisible();
        await expect(page.getByText('正在加载表情包...')).toBeHidden();

        releaseExport();
        await expect(page.getByText('表情包“回归测试表情包”已导出')).toBeVisible({
            timeout: 15_000,
        });
    });
});

/**
 * Issue #346: 网络抽风 / 中间代理篡改时，POST /auth 可能短暂返回 5xx 或被
 * 改写成 success=false。老 AuthProvider 只要 success 不为 truthy 就清掉本地
 * token + 跳回 /auth，把已经登录的用户踢出。新版只有 401 / 403 才会清 token，
 * 其它一律放行。这里通过 page.route 模拟两种场景：
 *   1. POST /auth 返回 502 → 用户保留 token，停留在主界面
 *   2. POST /auth 返回 200 + `{ success: false }` 但状态码不是 401/403 → 同上
 */
test.describe('Auth validation resilience (issue #346)', () => {
    test('transient 502 on /auth keeps the user inside the app', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        // 用 page.route 拦 POST /auth，在第一次校验请求上返回 502；后续别的
        // /auth 流程都走真接口。
        let blocked = false;
        await page.route('**/auth', async (route, request) => {
            if (!blocked && request.method() === 'POST') {
                blocked = true;
                await route.fulfill({
                    status: 502,
                    contentType: 'text/html',
                    body: '<html><body>Bad Gateway</body></html>',
                });
                return;
            }
            await route.continue();
        });

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // 等到 AuthProvider 走完 / 渲染主界面：侧栏一定有「会话」入口。
        await expect(page.getByRole('button', { name: '会话', exact: true }))
            .toBeVisible({ timeout: 15_000 });

        // 用户没有被踢回 /auth。
        expect(new URL(page.url()).pathname).not.toMatch(/\/auth\/?$/);

        // localStorage 里的 token 也没被清掉。
        const stored = await page.evaluate(() => localStorage.getItem('qce_access_token'));
        expect(stored).toBe(TOKEN);
    });

    test('non-401/403 with success:false body still keeps the user inside the app', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        let blocked = false;
        await page.route('**/auth', async (route, request) => {
            if (!blocked && request.method() === 'POST') {
                blocked = true;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: false,
                        error: { type: 'PROXY_TAMPERING', message: 'reverse proxy ate the body' },
                    }),
                });
                return;
            }
            await route.continue();
        });

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        await expect(page.getByRole('button', { name: '会话', exact: true }))
            .toBeVisible({ timeout: 15_000 });
        expect(new URL(page.url()).pathname).not.toMatch(/\/auth\/?$/);
        const stored = await page.evaluate(() => localStorage.getItem('qce_access_token'));
        expect(stored).toBe(TOKEN);
    });

    test('explicit 403 still clears token and redirects to /auth', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        await page.route('**/auth', async (route, request) => {
            if (request.method() === 'POST') {
                await route.fulfill({
                    status: 403,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        success: false,
                        error: { type: 'AUTH_ERROR', message: 'invalid token', context: { code: 'INVALID_TOKEN' } },
                    }),
                });
                return;
            }
            await route.continue();
        });

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // 真 token 失效，前端应当踢回 /auth 并清掉 localStorage。
        await page.waitForURL(/\/auth\/?$/, { timeout: 15_000 });
        const stored = await page.evaluate(() => localStorage.getItem('qce_access_token'));
        expect(stored).toBeNull();
    });
});

/**
 * Issue #340: 独立模式（start-standalone.bat）下没有 NapCat / QQ 登录态。
 * 老版本进入 sessions 标签页会立刻发起 /api/friends + /api/groups，两个端点
 * 都回 503 STANDALONE_MODE，前端在右上角连弹两次红色 toast，且 SessionList
 * 卡在「加载中」。这里通过路由拦截把 /api/system/info 的 mode 改成 'standalone'，
 * 验证前端会换成专门的引导卡片，并不再发出 friends / groups 请求。
 */
test.describe('Standalone mode (issue #340)', () => {
    test('sessions tab shows a standalone banner instead of loading friends/groups', async ({ page }) => {
        await clearLocalStorage(page);
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value);
        }, TOKEN);

        // 拦 /api/system/info：把 mode 改成 standalone，napcat.online 改成 false。
        await page.route('**/api/system/info', async (route, request) => {
            if (request.method() !== 'GET') {
                await route.continue();
                return;
            }
            const original = await route.fetch();
            const json = await original.json();
            if (json?.success && json.data) {
                json.data.mode = 'standalone';
                if (json.data.napcat) {
                    json.data.napcat.online = false;
                }
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(json),
            });
        });

        // 监控 friends / groups，应当一次都不被请求。
        const friendsRequests: string[] = [];
        const groupsRequests: string[] = [];
        page.on('request', (req) => {
            const url = req.url();
            if (url.includes('/api/friends')) friendsRequests.push(url);
            if (url.includes('/api/groups')) groupsRequests.push(url);
        });

        const response = await page
            .goto(`${FRONTEND_BASE}${SHELL_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        // 跳过欢迎弹窗（如有）。
        const skipBtn = page.getByRole('button', { name: '跳过' }).first();
        if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await skipBtn.click().catch(() => null);
        }

        const sessionsTab = page.getByRole('button', { name: '会话', exact: true });
        await expect(sessionsTab).toBeVisible({ timeout: 15_000 });
        await sessionsTab.click();

        // 引导卡片可见。
        const banner = page.getByTestId('sessions-standalone-banner');
        await expect(banner).toBeVisible({ timeout: 10_000 });
        await expect(banner.getByText('当前是独立模式')).toBeVisible();
        await expect(banner.getByRole('button', { name: /浏览聊天记录/ })).toBeVisible();

        // 给一点时间确保前端没有偷偷发请求。
        await page.waitForTimeout(800);
        expect(friendsRequests, 'standalone mode must skip /api/friends').toEqual([]);
        expect(groupsRequests, 'standalone mode must skip /api/groups').toEqual([]);

        // 点击「浏览聊天记录」直接跳到 history 标签页。history 标签页的内容区
        // 一定带「记录列表」这个 segment 切换按钮，用它来确认跳转成功。
        await banner.getByRole('button', { name: /浏览聊天记录/ }).click();
        await expect(
            page.getByRole('button', { name: '记录列表', exact: true })
        ).toBeVisible({ timeout: 10_000 });
    });
});
