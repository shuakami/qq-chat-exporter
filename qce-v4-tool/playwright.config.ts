/**
 * Playwright E2E config.
 *
 * Pointed at the Mock API Server in `plugins/qq-chat-exporter`. Run with:
 *
 *     # 1. start the mock server on :40653
 *     cd plugins/qq-chat-exporter && npm run mock:server
 *
 *     # 2. start the frontend dev server on :3000 (separate terminal)
 *     cd qce-v4-tool && npm run dev
 *
 *     # 3. run the tests (this directory)
 *     npx playwright install chromium  # one-time
 *     npx playwright test
 *
 * Set `E2E_FRONTEND_URL` to point at a different frontend host (e.g. the
 * built bundle served by the mock server itself at
 * http://localhost:40653/qce-v4-tool/).
 */

import { defineConfig, devices } from '@playwright/test';

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? 'http://localhost:3000';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:40653';
const MOCK_TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }]
    ],
    use: {
        baseURL: FRONTEND_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        }
    ],
    metadata: {
        api_url: API_URL,
        token: MOCK_TOKEN
    }
});
