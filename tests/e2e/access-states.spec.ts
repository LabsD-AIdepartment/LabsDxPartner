import { test, expect } from '@playwright/test';
test('public login routes unavailable providers back safely', async ({ page }) => {
  await page.goto('/login?next=%2Fcontent%2Fclip-1');
  await page.getByRole('link', { name: 'เข้าสู่ระบบด้วย Google' }).click();
  await expect(page.getByRole('heading', { name: 'กำลังเตรียมเปิดการเข้าสู่ระบบ' })).toBeVisible();
  await page.getByRole('link', { name: 'กลับไปหน้าเข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fcontent%2Fclip-1$/);
});
test('mobile access variants and isolated preview approval', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/access-preview');
  await page.getByRole('button', { name: 'เข้าสู่ระบบด้วย LINE' }).click();
  await expect(page.getByRole('heading', { name: 'กำลังตรวจสอบสิทธิ์ของคุณ' })).toBeVisible();
  await page.getByRole('button', { name: 'จำลองอนุมัติสิทธิ์' }).click();
  await page
    .getByRole('link', { name: 'My content', exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create Share Get rewarded');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('public reason and cookie cannot authorize a partner route', async ({ page, context }) => {
  await context.addCookies([{ name: 'demo-auth', value: 'active', url: 'http://127.0.0.1:4187' }]);
  await page.goto('/transactions?reason=active');
  await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);
  await expect(page.getByRole('heading', { name: 'ยินดีต้อนรับ พาร์ทเนอร์' })).toBeVisible();
});
