import { test, expect } from '@playwright/test';
test('account remains in partner navigation and retains its final login method', async ({
  page,
}) => {
  await page.goto('/overview-preview');
  await page.getByRole('link', { name: 'บัญชีของคุณ', exact: true }).click();
  await page.getByRole('button', { name: 'ยกเลิกการเชื่อม LINE', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('มดดำ');
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'ยกเลิกการเชื่อม Google', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'เมนูเจ้าหน้าที่' })).toHaveCount(0);
  await page.getByLabel('สถานการณ์บัญชี').selectOption('conflict');
  await page.getByRole('button', { name: 'เชื่อมบัญชี Apple', exact: true }).click();
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('บัญชีอื่น');
});
test('staff payment requires a concrete review and reduces only the remaining obligation', async ({
  page,
}) => {
  await page.goto('/ops-preview/periods');
  await page.getByText('บันทึกการชำระ', { exact: true }).click();
  await page.getByLabel('เงินโอน (บาท)', { exact: true }).fill('9700');
  await page.getByLabel('ภาษีหัก ณ ที่จ่าย (บาท)', { exact: true }).fill('300');
  await page
    .getByLabel('จ่ายจริงวันที่และเวลา (ประเทศไทย)', { exact: true })
    .fill('2026-09-01T10:00');
  await page.getByLabel('เลขอ้างอิงการชำระ', { exact: true }).fill('synthetic-transfer');
  await page.getByLabel('อ้างอิงหลักฐานการชำระ', { exact: true }).fill('synthetic-proof');
  await page.getByRole('button', { name: 'ตรวจรายการชำระ', exact: true }).click();
  const review = page.getByRole('dialog');
  for (const text of ['partner-1', 'statement-1', '฿9,700', '฿300', 'synthetic-proof'])
    await expect(review).toContainText(text);
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(page.getByText('฿15,520', { exact: true })).toBeVisible();
  await expect(page.getByText('฿37,360', { exact: true })).toBeVisible();
});
test('changed staff revision refuses publication until fresh review', async ({ page }) => {
  await page.goto('/ops-preview/periods');
  await page.getByLabel('สถานการณ์เจ้าหน้าที่').selectOption('changed');
  await page.getByRole('button', { name: 'ตรวจการเผยแพร่' }).click();
  await page.getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('ข้อมูลถูกแก้ไขแล้ว');
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await page.getByLabel('สถานการณ์เจ้าหน้าที่').selectOption('read-only');
  await expect(page.getByRole('button', { name: 'ตรวจการเผยแพร่' })).toHaveCount(0);
});
