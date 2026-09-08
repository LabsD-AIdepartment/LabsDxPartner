import { test, expect } from '@playwright/test';
test('content filters do not rewrite payout; later settlement keeps selected filters', async ({
  page,
}) => {
  await page.goto('/overview-preview');
  await expect(page.getByText('฿37,360', { exact: true })).toBeVisible();
  await page.getByLabel('แบรนด์').selectOption('Axtion');
  await expect(page.getByText('฿15,920', { exact: true })).toBeVisible();
  await expect(page.getByText('฿25,520', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'จำลองบันทึกจ่าย 10,000 บาท' }).click();
  await expect(page.getByText('฿15,520', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('แบรนด์')).toHaveValue('Axtion');
  await expect(page.getByText('฿15,920', { exact: true })).toBeVisible();
  expect(
    await page.getByRole('link', { name: 'ดูรอบจ่ายนี้ ↗' }).getAttribute('href'),
  ).not.toContain('generation');
});
test('partial and unavailable are understandable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/overview-preview');
  await page.getByLabel('สถานการณ์ภาพรวม').selectOption('partial');
  await expect(page.getByText('มีรายได้ที่ยังไม่จับคู่กับคลิป')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('สถานการณ์ภาพรวม').selectOption('unavailable');
  await expect(page.getByText('ต้นทางยังไม่พร้อมให้ข้อมูล')).toBeVisible();
  await expect(page.getByText('฿37,360', { exact: true })).toHaveCount(0);
});
