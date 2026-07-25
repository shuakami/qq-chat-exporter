import { test, expect } from '@playwright/test';

const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://localhost:40653';
const AUTH_PATH = '/qce/auth';

test.describe('Auth token help (issue #349)', () => {
    test('distinguishes the QCE access token from the NapCat WebUI token', async ({ page }) => {
        const response = await page
            .goto(`${FRONTEND_BASE}${AUTH_PATH}`)
            .catch(() => null);
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        );

        await expect(page.getByText('请勿使用 NapCat WebUI Token。')).toBeVisible();
        await page.getByRole('button', { name: '找不到令牌？' }).click();

        const tokenWarning = page
            .getByText('NapCat WebUI Token 不能用于这里')
            .locator('..');
        await expect(tokenWarning).toBeVisible();
        await expect(tokenWarning).toContainText('只用于 NapCat 管理页');
        await expect(tokenWarning).toContainText('security.json');
        await expect(tokenWarning).toContainText('accessToken');
    });
});
