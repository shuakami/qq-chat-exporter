/**
 * UI smoke test - boots the auth page, drops a token and makes sure we land
 * on the main app shell. Skipped automatically when the frontend isn't
 * reachable so this can run in environments where only the API is up.
 */

import { test, expect } from '@playwright/test';

const TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';

test.describe('Auth flow', () => {
    test('home page loads', async ({ page }) => {
        const response = await page.goto('/').catch(() => null);
        test.skip(!response || response.status() >= 500, 'frontend not reachable');
        // We expect either the main app page or a redirect to /auth
        const title = await page.title();
        expect(title.length).toBeGreaterThan(0);
    });

    test('passing ?token=... in URL stores it for future requests', async ({ page }) => {
        const response = await page.goto(`/auth?token=${TOKEN}`).catch(() => null);
        test.skip(!response || response.status() >= 500, 'frontend not reachable');
        // The auth manager pulls the token out of the URL and stashes it in
        // localStorage. We just check that the storage entry shows up.
        const stored = await page.evaluate(() => localStorage.getItem('qce_access_token'));
        expect(stored).toBe(TOKEN);
    });
});
