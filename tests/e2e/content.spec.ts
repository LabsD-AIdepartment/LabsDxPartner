import { test, expect } from '@playwright/test';
test('Overview to clip to ad and back preserves the earnings context', async ({ page }) => {
  await page.goto('/overview-preview');
  await expect(page.getByText('฿37,360', { exact: true }).first()).toBeVisible();
  await page.getByRole('combobox', { name: 'แบรนด์', exact: true }).selectOption('Axtion');
  await expect(page.getByText('฿15,920', { exact: true }).first()).toBeVisible();
  const link = page.locator('a[href^="/content-preview/clip-1?"]').first();
  await link.click();
  await expect(page).toHaveURL(/\/content-preview\/clip-1\?/);
  await expect(page.getByText('฿12,800', { exact: true })).toBeVisible();
  const detailUrl = new URL(page.url());
  expect(detailUrl.searchParams.get('brand')).toBe('Axtion');
  expect(detailUrl.searchParams.get('generation')).toBe('1');
  expect(detailUrl.searchParams.get('origin')).toBe('overview');
  await page.getByText('โฆษณาที่ใช้คลิปนี้ (3)', { exact: true }).click();
  await page.getByRole('link', { name: /วิดีโอหลัก/ }).click();
  await expect(page).toHaveURL(/\/ads\/clip-1-ad-1\?/);
  await expect(page.getByText('81,200', { exact: true })).toBeVisible();
  await expect(page.getByText('ค่าโฆษณา', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '← กลับรายละเอียดคลิป' }).click();
  await expect(page).toHaveURL(/\/content-preview\/clip-1\?/);
  await expect(page.getByText('฿12,800', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← กลับภาพรวม' }).click();
  await expect(page).toHaveURL(/\/overview-preview\?/);
  await expect(page.getByRole('combobox', { name: 'แบรนด์', exact: true })).toHaveValue('Axtion');
  await expect(page.getByText('฿15,920', { exact: true }).first()).toBeVisible();
});
test('library shows all six portrait covers in one page and restores filters on return', async ({
  page,
}) => {
  await page.goto('/content-preview');
  await expect(page.getByText('฿12,800', { exact: true })).toBeVisible();
  await expect(page.locator('a[href^="/content-preview/clip-"] img')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toHaveCount(0);
  await page.locator('a[href^="/content-preview/clip-5?"]').click();
  await expect(page.getByText('฿7,400', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← กลับคลังคลิป' }).click();
  await expect(page.locator('a[href^="/content-preview/clip-"] img')).toHaveCount(6);
  await page.getByLabel('ค้นหาคลิปหรือแบรนด์', { exact: true }).fill('Axtion');
  await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toHaveCount(0);
  await expect(page.locator('a[href^="/content-preview/clip-"] img')).toHaveCount(2);
});
test('content layout fits narrow and wide widths with portrait framing', async ({ page }) => {
  for (const width of [280, 375, 800, 1162, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/content-preview');
    await expect(page.getByText('฿12,800', { exact: true })).toBeVisible();
    const size = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      covers: [...document.querySelectorAll('a[href^="/content-preview/clip-"] img')].map((img) => {
        const r = img.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    for (const cover of size.covers)
      expect(Math.abs(cover.w / cover.h - 9 / 16)).toBeLessThan(0.01);
  }
});
