import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { overviewFixture } from '../../dev/overview-transport';
import { defaultOverviewFilters as filters } from '@/features/overview/model';
import {
  earningsHighlights,
  pendingEarningsDisplay,
} from '@/features/overview/earnings-highlights';
import { EarningsSummary } from '@/features/overview/EarningsSummary';
const money = (minor: string) => ({ currency: 'THB' as const, minor });
function partialOverview() {
  const data = overviewFixture(filters);
  data.earnings.estimated = null;
  data.earnings.connectedAdEarnings = ['173460', null].map((minor, i) => ({
    clipId: `clip-${i}`,
    title: `Connected ${i}`,
    amount: minor === null ? null : money(minor),
    sales: null,
    ratePpm: 30000,
    status: 'estimated',
    reason: null,
    fetchedAt: null,
  }));
  return data;
}
describe('overview pending subtotal and creator insights', () => {
  it('shows known commission despite an unknown connection, explicitly as an incomplete subtotal', () => {
    const data = partialOverview();
    const before = JSON.stringify(data);
    render(<EarningsSummary data={data} filters={filters} />);
    expect(screen.getByText('฿1,734.60')).toBeVisible();
    expect(screen.getByText(/ยังไม่ใช่ยอดรวมทั้งหมดและยังถอนไม่ได้/)).toBeVisible();
    expect(screen.queryByText(/Connected 0/)).toBeNull();
    expect(JSON.stringify(data)).toBe(before);
    expect(data.earnings.estimated).toBeNull();
  });
  it('uses an authoritative total without adding its included connections again', () => {
    const { earnings } = partialOverview();
    earnings.estimated = money('220464');
    expect(pendingEarningsDisplay(earnings)).toEqual({ amount: money('220464'), partial: false });
  });
  it('distinguishes a known zero subtotal from all missing estimates', () => {
    const { earnings } = partialOverview();
    earnings.connectedAdEarnings![0].amount = money('0');
    expect(pendingEarningsDisplay(earnings)).toEqual({ amount: money('0'), partial: true });
    earnings.connectedAdEarnings![0].amount = null;
    expect(pendingEarningsDisplay(earnings)).toEqual({ amount: null, partial: false });
  });
  it('derives the sales leader from sales, updates with the input, and does not invent growth', () => {
    const { earnings } = overviewFixture(filters);
    earnings.eligibleSales = money('10000');
    earnings.trend = [
      {
        date: '2026-07-01',
        amount: money('0'),
        sales: money('10000'),
        salesByPlatform: [
          { platform: 'facebook', sales: money('2000') },
          { platform: 'web', sales: money('8000') },
        ],
      },
    ];
    earnings.topContent = [];
    const before = JSON.stringify(earnings);
    expect(earningsHighlights(earnings)[0]).toEqual({
      id: 'platform',
      label: 'ยอดขายสูงสุดในช่วงที่เลือก',
      subject: 'LabsD Online',
      amount: money('8000'),
    });
    expect(JSON.stringify(earningsHighlights(earnings))).not.toMatch(/เติบโต|โตขึ้น|%/);
    expect(JSON.stringify(earnings)).toBe(before);
    earnings.trend[0].salesByPlatform![0].sales = money('9000');
    earnings.trend[0].salesByPlatform![1].sales = money('1000');
    expect(earningsHighlights(earnings)[0]).toMatchObject({
      subject: 'Facebook',
      amount: money('9000'),
    });
  });
  it('avoids highest-sales claims for incomplete attribution or tied leaders', () => {
    const { earnings } = overviewFixture(filters);
    earnings.eligibleSales = money('10000');
    earnings.trend = [
      {
        date: '2026-07-01',
        amount: money('0'),
        sales: money('1000'),
        salesByPlatform: [{ platform: 'facebook', sales: money('1000') }],
      },
    ];
    expect(earningsHighlights(earnings)[0]).toMatchObject({
      subject: 'Facebook',
      label: 'ยอดขายในข้อมูลช่วงที่เลือก',
    });
    earnings.eligibleSales = money('2000');
    earnings.trend[0].sales = money('2000');
    earnings.trend[0].salesByPlatform!.push({ platform: 'web', sales: money('1000') });
    expect(earningsHighlights(earnings)[0].label).not.toContain('สูงสุด');
  });
  it('offers a neutral idea for missing data and never recommends removed clips', () => {
    const { earnings } = overviewFixture(filters);
    earnings.eligibleSales = null;
    earnings.topContent = earnings.topContent.map((clip) => ({ ...clip, removed: true }));
    expect(earningsHighlights(earnings)).toEqual([
      {
        id: 'idea',
        label: 'ลองมุมใหม่ให้คลิปถัดไป',
        description: 'เล่าประสบการณ์ใช้สินค้า แล้วกลับมาดูผลในช่วงถัดไป',
      },
    ]);
  });
});
