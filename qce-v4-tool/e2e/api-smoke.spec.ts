/**
 * API smoke tests. Don't need the frontend running — just hit the mock server
 * directly. These exercise the same auth + REST contract the UI uses.
 */

import { test, expect } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:40653';
const TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';

test.describe('Mock API server', () => {
    test('GET /health returns healthy', async ({ request }) => {
        const res = await request.get(`${API_URL}/health`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('healthy');
    });

    test('GET /api/groups requires token then lists fixture groups', async ({ request }) => {
        const noAuth = await request.get(`${API_URL}/api/groups`);
        expect([401, 403]).toContain(noAuth.status());

        const res = await request.get(`${API_URL}/api/groups?token=${TOKEN}`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data.groups)).toBe(true);
        expect(body.data.groups.length).toBeGreaterThan(0);
        expect(body.data.groups[0]).toMatchObject({ groupCode: '999000', groupName: 'QCE Testing Group' });
    });

    test('GET /api/friends lists fixture friends', async ({ request }) => {
        const res = await request.get(`${API_URL}/api/friends?token=${TOKEN}`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        const uids = body.data.friends.map((f: { uid: string }) => f.uid).sort();
        expect(uids).toEqual(['u_alice', 'u_bob', 'u_charlie']);
    });

    test('GET /api/system/info returns mock self info', async ({ request }) => {
        const res = await request.get(`${API_URL}/api/system/info?token=${TOKEN}`);
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.napcat.selfInfo.uin).toBe('10000');
        expect(body.data.napcat.selfInfo.nick).toBe('TestSelf');
    });

    test('POST /api/messages/fetch returns mock conversation messages', async ({ request }) => {
        const res = await request.post(`${API_URL}/api/messages/fetch?token=${TOKEN}`, {
            data: {
                peer: { chatType: 2, peerUid: '999000' },
                page: 1,
                limit: 50
            },
            headers: { 'X-Access-Token': TOKEN }
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data?.messages)).toBe(true);
    });
});
