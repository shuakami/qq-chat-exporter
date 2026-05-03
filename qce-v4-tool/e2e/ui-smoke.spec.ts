/**
 * UI smoke test - boots the auth page, drops a token and makes sure we land
 * on the main app shell. Skipped automatically when the frontend isn't
 * reachable so this can run in environments where only the API is up.
 *
 * To run these locally:
 *   1. `cd qce-v4-tool && pnpm build`
 *   2. `mkdir -p ../static && rm -rf ../static/qce-v4-tool && cp -r out ../static/qce-v4-tool`
 *   3. `cd ../plugins/qq-chat-exporter && pnpm mock:server`
 *   4. `cd ../../qce-v4-tool && E2E_FRONTEND_URL=http://localhost:40653 pnpm exec playwright test e2e/ui-smoke.spec.ts`
 *
 * The mock server serves the built frontend under `/qce-v4-tool/...` plus the
 * REST API on the same origin, which matches production routing far more
 * closely than `next dev` does.
 */

import { test, expect } from '@playwright/test';

const TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';
const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://localhost:40653';
// Production URL has the frontend living under `/qce-v4-tool/`.
const AUTH_PATH = `/qce-v4-tool/auth`;
const SHELL_PATH = `/qce-v4-tool`;

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
     * `…/qce-v4-tool/auth?token=<accessToken>`. The auth page should detect
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
     * Issue #363: 当本次导出有资源下载失败时，任务列表里这条任务下面应当出现
     * 一段说明 Rkey 降级和重试方法的提示文案。这里直接拦截 `/api/tasks` 把一条
     * 带 `resourceSummary.failed > 0` 的完成态任务塞进去，验证 UI 真的会渲染。
     */
    test('completed task with failed resources shows Rkey explanation banner (issue #363)', async ({ page }) => {
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
        // 数字行
        await expect(page.getByText(/资源 8\/12，失败 4/)).toBeVisible({ timeout: 10_000 });
        // Rkey 解释文案
        await expect(page.getByText(/Rkey 服务临时降级|重新点开这些消息/)).toBeVisible({ timeout: 10_000 });
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
