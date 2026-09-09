import { test, expect } from '@playwright/test';
test('Overview old earnings period sees later payment and returns with filters', async ({
  page,
}) => {
  await page.goto('/overview-preview');
  await expect(page.getByText('฿37,360', { exact: true }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'แบรนด์', exact: true }).selectOption('Axtion');
  await expect(page.getByText('฿15,920', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'ดูรอบจ่ายนี้ ↗' }).click();
  await expect(page.getByText('฿25,520', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'จำลองบันทึกจ่าย 10,000 บาท' }).click();
  await expect(page.getByText('฿15,520', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('฿37,360', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'กลับหน้าก่อนหน้า', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'แบรนด์', exact: true })).toHaveValue('Axtion');
  await expect(page.getByText('฿15,920', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('฿15,520', { exact: true }).first()).toBeVisible();
});
test('statements and documents expose ready, error and forbidden states', async ({ page }) => {
  await page.goto('/transactions-preview/statement-1');
  await page.getByRole('button', { name: 'เตรียมดาวน์โหลด' }).first().click();
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด', exact: true })).toBeVisible();
  await page.getByLabel('สถานะดาวน์โหลด').selectOption('forbidden');
  await page.getByRole('button', { name: 'เตรียมดาวน์โหลด' }).first().click();
  await expect(page.getByText('คุณไม่มีสิทธิ์ดาวน์โหลดเอกสารนี้')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ดาวน์โหลด', exact: true })).toHaveCount(0);
  await page.getByLabel('สถานการณ์รอบจ่าย').selectOption('credit');
  await expect(page.getByText('-฿2,640', { exact: true }).first()).toBeVisible();
});
test('transactions preserve readable typography and fit narrow/wide layouts', async ({ page }) => {
  for (const width of [280, 375, 800, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/transactions-preview', '/transactions-preview/statement-1']) {
      await page.goto(route);
      await expect(page.getByText('฿25,520', { exact: true }).first()).toBeVisible();
      const measurements = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        min: Math.min(
          ...[...document.querySelectorAll('main p,main dt,main dd,main button,main h2')]
            .filter((e) => e.getBoundingClientRect().width)
            .map((e) => parseFloat(getComputedStyle(e).fontSize)),
        ),
      }));
      expect(measurements.scroll).toBeLessThanOrEqual(width + 1);
      expect(measurements.min).toBeGreaterThanOrEqual(16);
    }
  }
});
