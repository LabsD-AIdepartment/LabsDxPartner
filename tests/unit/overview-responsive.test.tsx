import { StrictMode, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { MoneyValue } from '@/contracts/common';
import { AppShell } from '@/features/shell/AppShell';
import { PageTitleActions } from '@/shared/ui/PageTitleActions';
import { PlatformSalesChart } from '@/features/overview/PlatformSalesChart';
import { BarChart } from '@/shared/charts/BarChart';
import { Money } from '@/shared/ui/Money';
import { platformSalesItems } from '@/features/overview/platform-sales';
import { overviewFixture } from '../../dev/overview-transport';
import { defaultOverviewFilters } from '@/features/overview/model';

const money = (minor: string): MoneyValue => ({ currency: 'THB', minor });
const base = () => overviewFixture(defaultOverviewFilters).earnings;

describe('Overview title actions placement', () => {
  function Controls() {
    const [count, setCount] = useState(0);
    return (
      <PageTitleActions>
        <button onClick={() => setCount(count + 1)}>Export {count}</button>
      </PageTitleActions>
    );
  }
  it('retains feature-owned state in the shell title row and removes actions on navigation', () => {
    function Page() {
      const [overview, setOverview] = useState(true);
      return (
        <AppShell active="overview" title="Your content" accent="Your impact" notifications={null}>
          {overview && <Controls />}
          <button onClick={() => setOverview(false)}>Go to content</button>
        </AppShell>
      );
    }
    render(
      <StrictMode>
        <Page />
      </StrictMode>,
    );
    const row = screen.getByRole('heading', { level: 1 }).parentElement!;
    fireEvent.click(within(row).getByRole('button', { name: 'Export 0' }));
    expect(within(row).getByRole('button', { name: 'Export 1' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Export/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Go to content' }));
    expect(within(row).queryByRole('button')).toBeNull();
  });
  it('keeps standalone controls functional without a shell provider', () => {
    render(<Controls />);
    fireEvent.click(screen.getByRole('button', { name: 'Export 0' }));
    expect(screen.getByRole('button', { name: 'Export 1' })).toBeVisible();
  });
});

describe('Platform sales presentation', () => {
  it('omits residual, absent and zero platforms without redistributing sales or changing the headline', () => {
    const earnings = {
      ...base(),
      eligibleSales: money('12000'),
      trend: [
        {
          date: '2026-08-01',
          amount: money('1000'),
          sales: money('9000'),
          salesByPlatform: [
            { platform: 'facebook' as const, sales: money('10000') },
            { platform: 'shopee' as const, sales: money('0') },
            { platform: 'tiktok' as const, sales: money('-1000') },
          ],
        },
      ],
    };
    render(
      <>
        <Money value={earnings.eligibleSales} />
        <PlatformSalesChart earnings={earnings} />
      </>,
    );
    const chart = screen.getByRole('img', { name: 'Facebook: ฿100.00, TikTok: -฿10.00' });
    expect(within(chart).getByText('Facebook')).toBeVisible();
    expect(within(chart).getByText('TikTok')).toBeVisible();
    expect(screen.queryByTitle('Shopee')).toBeNull();
    expect(screen.queryByTitle('Lazada')).toBeNull();
    expect(screen.queryByTitle('Webmarketplace')).toBeNull();
    expect(within(chart).getByText('-10')).toBeVisible();
    expect(screen.queryByText('ยังไม่ระบุแพลตฟอร์ม')).toBeNull();
    expect(screen.queryByText('฿30')).toBeNull();
    expect(screen.getByText('฿120')).toBeVisible();
    expect(platformSalesItems(earnings)?.at(-1)?.value).toEqual(money('3000'));
    expect(chart).not.toHaveAccessibleName(/ยังไม่ระบุ/);
  });
  it('keeps the signed headline but omits the chart when no platform attribution exists', () => {
    const earnings = { ...base(), eligibleSales: money('-12000'), trend: [] };
    render(
      <>
        <Money value={earnings.eligibleSales} />
        <PlatformSalesChart earnings={earnings} />
      </>,
    );
    expect(screen.queryByText('ยังไม่ระบุแพลตฟอร์ม')).toBeNull();
    expect(screen.getByText('-฿120')).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('omits unavailable and empty charts without missing-data filler or invented platforms', () => {
    const view = render(
      <PlatformSalesChart earnings={{ ...base(), eligibleSales: null, trend: [] }} />,
    );
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(
      <PlatformSalesChart earnings={{ ...base(), eligibleSales: money('0'), trend: [] }} />,
    );
    expect(screen.queryByText('ยังไม่มีข้อมูลยอดขายแยกตามแพลตฟอร์ม')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(view.container).toBeEmptyDOMElement();
  });
  it('aliases web sales as LabsD Online only in the view, retaining the exact source amount', () => {
    const earnings = {
      ...base(),
      eligibleSales: money('12345678'),
      trend: [
        {
          date: '2026-08-01',
          amount: money('1000'),
          sales: money('12345678'),
          salesByPlatform: [{ platform: 'web' as const, sales: money('12345678') }],
        },
      ],
    };
    render(<PlatformSalesChart earnings={earnings} />);
    expect(screen.getByRole('img')).toHaveAccessibleName('LabsD Online: ฿123,456.78');
    expect(screen.getByText('LabsD Online')).toBeVisible();
    expect(screen.getByText('123.45678k')).toBeVisible();
    expect(screen.queryByText('Webmarketplace')).toBeNull();
    expect(platformSalesItems(earnings)).toEqual([
      { label: 'Webmarketplace', value: money('12345678') },
    ]);
  });
  it('keeps the generic chart compatible with text-only callers and exact compact amounts', () => {
    const view = render(
      <BarChart items={[{ label: 'A long generic category', value: money('12345678') }]} />,
    );
    expect(screen.getByText('A long generic category')).toBeVisible();
    expect(screen.getByText('123.45678k')).toHaveAttribute('title', '฿123,456.78');
    expect(view.container.querySelector('svg')).toBeNull();
  });
});
