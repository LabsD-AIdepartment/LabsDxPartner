import { test, expect } from '@playwright/test';
const routes = [
  { path: '/overview-preview', label: 'สถานการณ์ภาพรวม' },
  { path: '/content-preview', label: 'สถานการณ์คลิป' },
  { path: '/content-preview/clip-1', label: 'สถานการณ์คลิป' },
  { path: '/content-preview/clip-1/ads/clip-1-ad-1', label: 'สถานการณ์คลิป' },
  { path: '/transactions-preview', label: 'สถานการณ์รอบจ่าย' },
  { path: '/transactions-preview/statement-1', label: 'สถานการณ์รอบจ่าย' },
  { path: '/account-preview', label: 'สถานการณ์บัญชี' },
  { path: '/ops-preview/partners', label: 'สถานการณ์เจ้าหน้าที่' },
  { path: '/ops-preview/imports', label: 'สถานการณ์เจ้าหน้าที่' },
  { path: '/ops-preview/periods', label: 'สถานการณ์เจ้าหน้าที่' },
];
for (const route of routes)
  test(`state and responsive acceptance ${route.path}`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto(route.path);
    const main = page.locator('main'),
      select = page.getByLabel(route.label);
    const available = await select.locator('option').allTextContents();
    for (const mode of ['loading', 'error', 'partial', 'stale', 'unavailable', 'empty', 'ready']) {
      if (!available.includes(mode)) continue;
      await select.selectOption(mode);
      if (mode === 'loading') {
        await expect(main.getByText('กำลังโหลดข้อมูล', { exact: true })).toBeVisible();
        continue;
      }
      await expect(main.getByText('กำลังโหลดข้อมูล', { exact: true })).toHaveCount(0);
      if (mode === 'error') await expect(main.getByRole('alert').first()).toBeVisible();
      if (mode === 'partial' || mode === 'stale' || mode === 'unavailable')
        await expect(main.getByRole('status').first()).toBeVisible();
      if (mode === 'error' || mode === 'unavailable')
        await expect(main.getByText(/฿[\d,]+/)).toHaveCount(0);
      if (mode === 'ready') await expect(main.locator('article').first()).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['dark', 'light']) {
        const wanted = theme === 'dark' ? 'Dark' : 'Day';
        const toggle = page.getByRole('button', { name: `เปลี่ยนเป็นโหมด ${wanted}`, exact: true });
        if (await toggle.count()) await toggle.click();
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          min: Math.min(
            ...[
              ...document.querySelectorAll(
                'main p,main dt,main dd,main button,main label,main input',
              ),
            ]
              .filter((e) => e.getBoundingClientRect().width)
              .map((e) => parseFloat(getComputedStyle(e).fontSize)),
          ),
        }));
        expect(layout.scroll).toBeLessThanOrEqual(width + 1);
        expect(layout.min).toBeGreaterThanOrEqual(16);
        await testInfo.attach(`layout-${width}-${theme}`, {
          body: JSON.stringify(layout),
          contentType: 'application/json',
        });
      }
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('ready-desktop-day.png'), fullPage: true });
  });
