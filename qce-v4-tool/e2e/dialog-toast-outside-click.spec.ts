/**
 * Regression: 导出完成 toast（z-index 高于 Dialog）点击任意处时，
 * 不应被 Radix Dialog 当成「点外部」而关闭任务向导。
 *
 * 本地跑法与其它 UI e2e 相同：mock server + 已构建的 /qce 静态资源，
 * 或 next dev + mock API。
 */

import { test, expect } from '@playwright/test';

const TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests';
const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://localhost:40653';
const SHELL_PATH = `/qce`;

async function clearLocalStorage(page: import('@playwright/test').Page) {
  await page.goto(`${FRONTEND_BASE}${SHELL_PATH}`).catch(() => null);
  await page.evaluate(() => localStorage.clear()).catch(() => null);
}

test.describe('Dialog vs completion toast outside click', () => {
  test('clicking a toast does not dismiss the task wizard', async ({ page }) => {
    // This UI-only test injects its own toast; isolate broadcasts from other export tests.
    await page.routeWebSocket('**', () => {});
    await clearLocalStorage(page);
    await page.evaluate((value) => {
      localStorage.setItem('qce_access_token', value);
    }, TOKEN);

    const response = await page.goto(`${FRONTEND_BASE}${SHELL_PATH}`).catch(() => null);
    test.skip(
      !response || response.status() >= 500,
      `frontend not reachable at ${FRONTEND_BASE}`
    );

    const skipBtn = page.getByRole('button', { name: '跳过' }).first();
    if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await skipBtn.click().catch(() => null);
    }

    await page.getByRole('button', { name: '新建任务' }).first().click();
    const wizard = page.getByRole('dialog', { name: '创建导出任务' });
    await expect(wizard).toBeVisible({ timeout: 15_000 });

    // Toaster 根节点应带稳定标记，供 Dialog 识别「点在 toast 上」。
    const toaster = page.locator('[data-qce-toaster]');
    await expect(toaster).toHaveCount(1);

    // 在真实 Toaster 内注入可点的完成态卡片（与生产 toast 一样 pointer-events-auto）。
    await page.evaluate(() => {
      const root = document.querySelector('[data-qce-toaster]');
      if (!root) throw new Error('missing data-qce-toaster');
      const card = document.createElement('div');
      card.setAttribute('data-testid', 'fake-completion-toast');
      card.textContent = '导出完成';
      card.style.cssText =
        'pointer-events:auto;padding:16px;background:white;border:1px solid #ddd;border-radius:12px;';
      root.appendChild(card);
    });

    await page.getByTestId('fake-completion-toast').click();
    await expect(wizard).toBeVisible();

    await page.getByRole('button', { name: '取消' }).click();
    await expect(wizard).toBeHidden();
  });
});
