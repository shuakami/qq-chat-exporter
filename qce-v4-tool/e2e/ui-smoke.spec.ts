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
