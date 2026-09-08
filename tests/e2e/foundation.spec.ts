import { test, expect } from '@playwright/test';

test('server chart hydrates and modal restores keyboard focus', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/foundation');
  const exportButton = page.getByRole('button', { name: 'Export report', exact: true });
  await exportButton.click();
  await expect(page.getByRole('dialog', { name: 'Export report', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(exportButton).toBeFocused();
  expect(errors).toEqual([]);
});

test('scope-neutral components render on mobile with exact large amounts and failed covers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/foundation');
  await expect(
    page.getByRole('img', { name: 'ภาพตัวอย่างที่โหลดไม่สำเร็จ — ไม่สามารถโหลดภาพได้' }),
  ).toBeVisible();
  await expect(page.getByText('฿9,007,199,254,740,993.01', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page
    .getByRole('button', { name: 'My content', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create Share Get rewarded');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('notification seen state removes its unread badge', async ({ page }) => {
  await page.goto('/foundation');
  await page
    .getByRole('button', { name: 'การแจ้งเตือน 1 รายการที่ยังไม่อ่าน', exact: true })
    .click();
  await page.getByRole('button', { name: 'อ่านแล้ว', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'การแจ้งเตือน', exact: true })).toBeVisible();
});
