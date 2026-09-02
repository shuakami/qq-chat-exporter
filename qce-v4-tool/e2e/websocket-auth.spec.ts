import { test, expect } from '@playwright/test';

const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://localhost:40653';
const BASE_PATH = process.env.QCE_E2E_BASE_PATH ?? '/qce';
// Synthetic fixture with URL delimiters to catch missing query escaping.
const TOKEN = 'websocket-auth-fixture?%&=/';

for (const tokenSource of ['url', 'storage'] as const) {
    test(`progress and search sockets authenticate after ${tokenSource} login`, async ({ page }) => {
        await page.addInitScript(({ token, source }) => {
            localStorage.setItem('qce-onboarding-completed', 'true');
            if (source === 'storage') localStorage.setItem('qce_access_token', token);
        }, { token: TOKEN, source: tokenSource });

        await page.route('**/auth', async (route) => {
            expect(route.request().postDataJSON().token).toBe(TOKEN);
            await route.fulfill({ json: { success: true } });
        });
        await page.route('https://api.github.com/**', (route) => route.fulfill({ json: [] }));
        await page.route('**/security-status', (route) => route.fulfill({
            json: { success: true, data: { hasConfig: true, tokenExpired: false, requiresAuth: true } },
        }));
        await page.route('**/api/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            const fixtures: Record<string, unknown> = {
                '/api/system/info': {
                    name: 'QQ Chat Exporter', version: 'test', mode: 'plugin',
                    napcat: { online: true, selfInfo: { uid: 'fixture', uin: '10001', nick: 'Fixture' } },
                    runtime: { platform: 'test', uptime: 1 },
                },
                '/api/groups': {
                    groups: [{ groupCode: '12345', groupName: 'WebSocket fixture', memberCount: 1 }],
                    totalCount: 1, currentPage: 1, totalPages: 1, hasNext: false,
                },
                '/api/friends': { friends: [], totalCount: 0 },
                '/api/recent-contacts': { contacts: [] },
                '/api/tasks': { tasks: [] },
                '/api/messages/fetch': { messages: [], totalCount: 0, totalPages: 1, hasNext: false },
                '/api/security/ip-whitelist': {
                    allowedIPs: ['127.0.0.1'], disabled: false, isDocker: false, currentClientIP: '127.0.0.1',
                },
            };
            await route.fulfill({ json: { success: true, data: fixtures[path] ?? {} } });
        });

        const socketUrls: string[] = [];
        const searchRequests: unknown[] = [];
        await page.routeWebSocket('**', (socket) => {
            const url = new URL(socket.url());
            expect(url.host).toBe(new URL(FRONTEND_BASE).host);
            expect(url.protocol).toBe(new URL(FRONTEND_BASE).protocol === 'https:' ? 'wss:' : 'ws:');
            expect(url.pathname).toBe('/');
            expect(url.searchParams.get('token')).toBe(TOKEN);
            socketUrls.push(socket.url());
            socket.onMessage((raw) => {
                const message = JSON.parse(String(raw));
                if (message.type === 'start_stream_search') {
                    searchRequests.push(message.data);
                    socket.send(JSON.stringify({
                        type: 'search_progress',
                        data: {
                            searchId: message.data.searchId, status: 'completed',
                            processedCount: 0, matchedCount: 0, results: [],
                        },
                    }));
                }
            });
        });

        const query = tokenSource === 'url' ? `?token=${encodeURIComponent(TOKEN)}` : '';
        await page.goto(`${FRONTEND_BASE}${BASE_PATH}/${query}`);
        await expect.poll(() => socketUrls.length).toBe(1);
        expect(new URL(page.url()).searchParams.has('token')).toBe(false);

        await page.getByRole('button', { name: '会话', exact: true }).click();
        await expect(page.getByText('WebSocket fixture', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '预览', exact: true }).click();
        await page.getByPlaceholder('搜索消息内容...').fill('search fixture');
        await page.getByRole('button', { name: '搜索', exact: true }).click();

        await expect.poll(() => socketUrls.length).toBe(2);
        await expect.poll(() => searchRequests.length).toBe(1);
        expect(searchRequests[0]).toMatchObject({
            peer: { chatType: 2, peerUid: '12345' }, searchQuery: 'search fixture',
        });
        await expect(page.getByText('找到 0 条', { exact: true })).toBeVisible();
    });
}
