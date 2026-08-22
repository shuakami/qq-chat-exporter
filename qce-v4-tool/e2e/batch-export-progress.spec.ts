import { test, expect } from '@playwright/test'

const TOKEN = process.env.QCE_MOCK_TOKEN ?? 'qce_mock_token_for_tests'
const FRONTEND_BASE = process.env.E2E_FRONTEND_URL ?? 'http://localhost:40653'
const SHELL_PATH = '/qce'

async function clearLocalStorage(page: import('@playwright/test').Page) {
    await page.goto(`${FRONTEND_BASE}${SHELL_PATH}`).catch(() => null)
    await page.evaluate(() => localStorage.clear()).catch(() => null)
}

test.describe('Batch export progress', () => {
    /**
     * 回归测试：page.tsx 的 handleBatchExport 会接收 dialog 传入的 onProgress
     * 回调，并在每个 createTask 完成后回调一次。dialog 依据回调逐会话推进
     * 进度（当前会话数和绿色成功勾均需满足）。
     * 断言进度严格按 1/3 → 2/3 → 3/3 推进、成功勾逐个出现。
     */
    test('page.tsx onProgress callback advances progress per session', async ({ page }) => {
        await clearLocalStorage(page)
        await page.evaluate((value) => {
            localStorage.setItem('qce_access_token', value)
        }, TOKEN)

        const response = await page.goto(`${FRONTEND_BASE}${SHELL_PATH}`).catch(() => null)
        test.skip(
            !response || response.status() >= 500,
            `frontend not reachable at ${FRONTEND_BASE}`
        )

        // 关掉欢迎弹窗（如有），切到会话标签页。
        const skipBtn = page.getByRole('button', { name: '跳过' }).first()
        if (await skipBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await skipBtn.click().catch(() => null)
        }
        const sessionsTab = page.getByRole('button', { name: '会话', exact: true })
        await expect(sessionsTab).toBeVisible({ timeout: 15_000 })
        await sessionsTab.click()

        // 进入批量选择模式。
        await page.getByRole('button', { name: '批量选择' }).click()

        // 逐个搜索并勾选三个会话。
        const searchBox = page.locator('input[placeholder*="搜索会话"]').first()
        await expect(searchBox).toBeVisible({ timeout: 15_000 })
        const sessions = ['Alice', 'Bob', 'QCE Testing Group']
        for (const name of sessions) {
            await searchBox.fill(name)
            await page.getByRole('checkbox', { name: `选择会话 ${name}` }).click()
        }

        // 打开批量导出对话框。
        await page.getByRole('button', { name: '设置并导出' }).click()
        const dialog = page.getByRole('dialog', { name: '批量导出聊天记录' })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText('已选择 3 个会话进行批量导出。')).toBeVisible()

        // 捕获每个导出请求，手动逐个放行，让每个进度中间态可观测。
        const exportRequests: Array<() => void> = []
        await page.route('**/api/messages/export', async (route) => {
            await new Promise<void>((resolve) => exportRequests.push(resolve))
            await route.continue()
        })

        await dialog.getByRole('button', { name: '开始批量导出' }).click()

        // 第 1 个请求发出：进度停在 1/3，尚无成功勾。
        await expect.poll(() => exportRequests.length, 'first export request sent').toBe(1)
        await expect(dialog.getByText('1 / 3 个会话')).toBeVisible()
        await expect(dialog.locator('svg.text-green-500')).toHaveCount(0)

        // 放行第 1 个：page.tsx 回传 success，进度推进到 2/3，出现 1 个成功勾。
        exportRequests[0]()
        await expect.poll(() => exportRequests.length, 'second export request sent').toBe(2)
        await expect(dialog.getByText('2 / 3 个会话')).toBeVisible()
        await expect(dialog.locator('svg.text-green-500')).toHaveCount(1)

        // 放行第 2 个：进度推进到 3/3，出现 2 个成功勾。
        exportRequests[1]()
        await expect.poll(() => exportRequests.length, 'third export request sent').toBe(3)
        await expect(dialog.getByText('3 / 3 个会话')).toBeVisible()
        await expect(dialog.locator('svg.text-green-500')).toHaveCount(2)

        // 放行第 3 个：全部完成，对话框自动关闭，弹出通知。
        exportRequests[2]()
        await expect(dialog).toBeHidden({ timeout: 15_000 })
        await expect(page.getByText('成功创建 3 个导出任务')).toBeVisible({ timeout: 15_000 })
    })
})
