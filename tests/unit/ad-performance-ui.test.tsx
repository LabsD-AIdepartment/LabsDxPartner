import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { z } from 'zod';
import type { PartnerAdPerformance } from '@/contracts/partner-ad-performance';
import type { Metric } from '@/contracts/content';
import type { PlatformMetricValue } from '@/contracts/platform-metrics';
import { AdPerformance } from '@/features/content/AdPerformance';
import { MetricSections } from '@/features/content/MetricDefinition';
import { ContentDetail } from '@/features/content/ContentDetail';
import type { ContentTransport } from '@/features/content/model';
import { ContentCardInfo } from '@/features/content/ContentCardInfo';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { initialReportContext } from '@/shared/routing/report-context';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import { contentFixture } from '../../dev/content-transport';

const period = {
  timezone: 'Asia/Bangkok' as const,
  from: '2026-07-01T00:00:00+07:00',
  toExclusive: '2026-09-01T00:00:00+07:00',
};
function metric(
  key: PlatformMetricValue['key'],
  value: string | null,
  unit: PlatformMetricValue['unit'],
): PlatformMetricValue {
  return {
    schemaVersion: 2,
    key,
    value,
    unit,
    currency: unit === 'money' ? 'THB' : null,
    definition: `Definition for ${key}`,
    unavailableReason: value === null ? 'ยังไม่มีข้อมูลจากต้นทาง' : null,
    aggregation: [
      'cpc',
      'ctr',
      'cpm',
      'cost_per_purchase',
      'roas',
      'reach',
      'purchase_conversion_rate',
    ].includes(key)
      ? 'non-additive'
      : 'sum-disjoint',
  };
}
function performance(): z.infer<typeof PartnerAdPerformance> {
  const metrics = [
    metric('cpc', '10.037485', 'money'),
    metric('ctr', '2.3456', 'ratio'),
    metric('link_clicks', '1240', 'count'),
    metric('purchase_conversion_rate', '4.11290322580645', 'ratio'),
    metric('cpm', '225.19', 'money'),
    metric('cost_per_purchase', null, 'money'),
    metric('roas', '1.71645', 'ratio'),
    metric('spend', '9007199254740993.01', 'money'),
    metric('platform_orders', '0', 'count'),
    metric('platform_value', '2000', 'money'),
    ...(['impressions', 'video_views', 'reach'] as const).map((key) =>
      metric(key, '87654321', 'count'),
    ),
  ];
  return {
    schemaVersion: 2,
    source: 'Facebook · Ad ID 52513673563767',
    period,
    coverage: { status: 'complete', periods: [period] },
    fetchedAt: '2026-09-17T03:00:00Z',
    dataThrough: period.toExclusive,
    definition: {
      apiVersion: 'v25.0',
      attribution: '7d_click+1d_view',
      actionReportTime: 'impression',
      reportTimezone: 'Asia/Bangkok',
    },
    state: 'ready',
    reasons: [],
    metrics,
    series: [{ period: { ...period, timezone: 'Asia/Bangkok' }, metrics }],
  };
}

describe('Celeb ad performance presentation', () => {
  it('explains the actual attribution window and closing-rate calculation in plain Thai', () => {
    const view = render(<AdPerformance performance={performance()} canViewAdSpend={false} />);
    const details = screen.getByText('วิธีนับผลลัพธ์ของแพลตฟอร์ม').closest('details')!;
    details.open = true;
    expect(within(details).getByText(/ภายใน 7 วันหลังคลิก หรือ 1 วันหลังเห็นโฆษณา/)).toBeVisible();
    expect(within(details).getByText(/ไม่ใช่วันที่ชำระเงิน.*เวลาประเทศไทย/)).toBeVisible();
    expect(within(details).getByText(/จำนวนออเดอร์จากโฆษณาหารด้วยจำนวนคลิกลิงก์/)).toBeVisible();
    expect(view.container.textContent).not.toMatch(/7d_click|v25\.0|impression/);
  });

  it.each([false, true])(
    'hides unapproved future metric keys regardless of spend permission=%s',
    (canViewAdSpend) => {
      // Simulate a future wire metric: widening a transport schema must not grant UI visibility.
      const legacy = {
        key: 'future_audience_count',
        value: 87654321,
        unit: 'count',
        definition: 'Unapproved future metric',
        source: 'Facebook',
        period,
        dataThrough: period.toExclusive,
        unavailableReason: null,
        additive: true,
      } as unknown as z.infer<typeof Metric>;
      const legacyView = render(
        <MetricSections metrics={[legacy]} canViewAdSpend={canViewAdSpend} />,
      );
      expect(legacyView.container.textContent).not.toContain('87,654,321');
      expect(legacyView.container.textContent).not.toContain('Unapproved future metric');
      legacyView.unmount();
      const p = performance();
      const future = {
        ...metric('platform_orders', '87654321', 'count'),
        key: 'future_audience_count',
      } as unknown as PlatformMetricValue;
      p.metrics = [future];
      p.series = [{ period: { ...period }, metrics: [future] }];
      const reportView = render(<AdPerformance performance={p} canViewAdSpend={canViewAdSpend} />);
      expect(reportView.container.textContent).not.toContain('87,654,321');
      expect(reportView.container.textContent).not.toContain('Definition for platform_orders');
    },
  );
  it.each([false, true])(
    'shows clicks and purchase rate while excluding audience counts from the report, spend permission=%s',
    (canViewAdSpend) => {
      const p = performance();
      const view = render(<AdPerformance performance={p} canViewAdSpend={canViewAdSpend} />);
      for (const key of ['impressions', 'video_views', 'reach']) {
        expect(view.container.textContent).not.toContain(`Definition for ${key}`);
      }
      expect(view.container.textContent).not.toContain('87,654,321');
      expect(view.container.querySelector('svg')).toBeNull();
      expect(screen.getByText('ROAS')).toBeVisible();
      expect(screen.getByText('คลิกลิงก์').closest('article')).toHaveTextContent('1,240');
      expect(screen.getByText('อัตราปิดการขาย').closest('article')).toHaveTextContent('4.11%');
      expect(screen.queryByText('411.29%')).toBeNull();
      expect(screen.getAllByText('1.72×')[0]).toBeVisible();
      expect(screen.getAllByText('2.35%')[0]).toBeVisible();
      expect(screen.queryByText('234.56%')).toBeNull();
      expect(screen.getByText('฿10.04')).toBeVisible();
      expect(screen.getByText('ต้นทุนต่อการซื้อ').closest('article')).toHaveTextContent('—');
      expect(screen.getByText('ออเดอร์ตามแพลตฟอร์ม').closest('article')).toHaveTextContent('0');
      if (canViewAdSpend) expect(screen.getByText('฿9,007,199,254,740,993.01')).toBeVisible();
      else {
        expect(screen.queryByText('ค่าโฆษณา')).toBeNull();
        expect(view.container.textContent).not.toContain('9,007,199,254,740,993.01');
        expect(view.container.textContent).not.toContain('Definition for spend');
      }
    },
  );

  it('shows source and freshness without the redundant date range, preserving percent values', () => {
    const p = performance();
    const view = render(<AdPerformance performance={p} canViewAdSpend={false} />);
    expect(screen.getByText('Facebook · Ad ID 52513673563767')).toBeVisible();
    expect(view.container.textContent).not.toContain(
      `${dateLabel(period.from)} – ก่อน ${dateLabel(period.toExclusive)}`,
    );
    expect(view.container.querySelector(`time[datetime="${p.fetchedAt}"]`)).toHaveTextContent(
      timestamp(p.fetchedAt),
    );
    expect(screen.getAllByText('2.35%')).toHaveLength(1);
    expect(screen.getAllByText('4.11%')).toHaveLength(1);
    expect(screen.getAllByText('1,240')).toHaveLength(1);
    expect(screen.queryByText(/ดูตัวเลขแยกตามช่วงรายงาน/)).toBeNull();
    expect(screen.getByText('วิธีนับผลลัพธ์ของแพลตฟอร์ม')).toBeVisible();
    expect(screen.queryByText('4.70%')).toBeNull();
    expect(screen.queryByText('ที่มาและความหมาย')).toBeNull();
  });

  it('keeps a zero purchase rate distinct from an unavailable rate', () => {
    const p = performance();
    p.metrics = [metric('purchase_conversion_rate', '0', 'ratio')];
    p.series = [];
    const view = render(<AdPerformance performance={p} canViewAdSpend={false} />);
    expect(screen.getByText('0.00%')).toBeVisible();
    view.rerender(
      <AdPerformance
        performance={{ ...p, metrics: [metric('purchase_conversion_rate', null, 'ratio')] }}
        canViewAdSpend={false}
      />,
    );
    expect(screen.queryByText('0.00%')).toBeNull();
    expect(screen.getByText('อัตราปิดการขาย').closest('article')).toHaveTextContent('—');
    expect(screen.getByText('ยังไม่มีข้อมูลจากต้นทาง')).toBeVisible();
  });

  it('keeps a partial metric unknown without directing readers to removed period rows', () => {
    const p = performance();
    const reason = 'ข้อมูลยังไม่ครบช่วงวันที่เลือก ดูช่วงที่มีข้อมูลด้านล่าง';
    p.metrics = [{ ...metric('cpc', null, 'money'), unavailableReason: reason }];
    render(<AdPerformance performance={p} canViewAdSpend={false} />);
    expect(screen.getByText('CPC').closest('article')).toHaveTextContent('—');
    expect(screen.getByText('ข้อมูลยังไม่ครบช่วงวันที่เลือก')).toBeVisible();
    expect(screen.queryByText(/ดูช่วงที่มีข้อมูลด้านล่าง/)).toBeNull();
    expect(p.metrics[0].unavailableReason).toBe(reason);
  });

  it('renders unavailable data as unknown without fabricated zero metric cards', () => {
    const p = performance();
    p.metrics = [];
    p.series = [];
    p.state = 'unavailable';
    p.fetchedAt = null;
    p.reasons = ['ยังไม่มีรายงานในช่วงนี้'];
    render(<AdPerformance performance={p} canViewAdSpend={false} />);
    expect(screen.getByText('ยังไม่มีรายงานในช่วงนี้')).toBeVisible();
    expect(screen.queryByText('ROAS')).toBeNull();
    expect(screen.queryByText('0.00%')).toBeNull();
  });

  it.each([false, true])(
    'applies the same privacy and percent policy to legacy metric sections, permission=%s',
    (canViewAdSpend) => {
      const metrics = performance().metrics.map((m) => ({
        ...m,
        value: m.value === null ? null : Number(m.value),
        unit: m.unit === 'money' ? ('THB' as const) : m.unit,
        source: 'Facebook',
        period,
        dataThrough: period.toExclusive,
        additive: m.aggregation === 'sum-disjoint',
      }));
      const view = render(<MetricSections metrics={metrics} canViewAdSpend={canViewAdSpend} />);
      expect(screen.getByText('ROAS')).toBeVisible();
      expect(screen.getAllByText('2.35%')[0]).toBeVisible();
      expect(view.container.textContent).not.toContain('87,654,321');
      expect(!!screen.queryByText('ค่าโฆษณา')).toBe(canViewAdSpend);
    },
  );

  it('does not display known or unknown view counts in any clip information card', () => {
    const clip = {
      title: 'คลิปตัวอย่าง',
      removed: false,
      adReferences: [],
      publishedAt: period.from,
      views: 87654321,
    };
    const view = render(<ContentCardInfo clip={clip} />);
    expect(view.container.textContent).not.toMatch(/views|ยอดดู|87,654,321/);
    expect(screen.getByText(dateLabel(period.from))).toBeVisible();
    const unknownViews = { ...clip, views: null };
    view.rerender(<ContentCardInfo clip={unknownViews} />);
    expect(view.container.textContent).not.toMatch(/views|ยอดดู/);
  });

  it('shows the optional shared report at clip detail without changing commission figures', async () => {
    const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
    const transport: ContentTransport = async (request) => {
      const data = contentFixture(request);
      return request.resource === 'detail'
        ? { ...data, data: { ...data.data, performance: performance() } }
        : data;
    };
    render(
      <ScopedQueryProvider scope={scope}>
        <ContentDetail
          scope={scope}
          context={initialReportContext}
          transport={transport}
          routes={{ content: '/content-preview', overview: '/overview-preview' }}
          canViewAdSpend={false}
          contentId="clip-1"
        />
      </ScopedQueryProvider>,
    );
    const card = (
      await screen.findByRole('heading', { name: 'ผลโฆษณาที่ใช้คลิปนี้', level: 2 })
    ).closest('article')!;
    expect(within(card).getByText('CPC')).toBeVisible();
    expect(within(card).getByText('ROAS')).toBeVisible();
    expect(screen.getByText('฿12,800')).toBeVisible();
    expect(screen.queryByText('฿128,000')).toBeNull();
    expect(screen.getByText('ยอดขายจากโฆษณา')).toBeVisible();
  });
  it.each(['content', 'partner-only'] as const)(
    'uses ad purchases for hero orders/AOV independently of %s commission attribution',
    async (attribution) => {
      const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
      const report = performance();
      report.metrics = [
        metric('platform_orders', '51', 'count'),
        metric('platform_value', '57820', 'money'),
      ];
      report.series = [];
      const transport: ContentTransport = async (request) => {
        const data = contentFixture(request);
        return request.resource === 'detail'
          ? {
              ...data,
              data: {
                ...data.data,
                attribution,
                eligibleSales:
                  attribution === 'content' ? { currency: 'THB', minor: '96000000' } : null,
                eligibleOrders: 999,
                performance: report,
              },
            }
          : data;
      };
      render(
        <ScopedQueryProvider scope={scope}>
          <ContentDetail
            scope={scope}
            context={initialReportContext}
            transport={transport}
            routes={{ content: '/content-preview', overview: '/overview-preview' }}
            canViewAdSpend={false}
            contentId="clip-1"
          />
        </ScopedQueryProvider>,
      );
      const orders = (await screen.findByText('ออเดอร์จากโฆษณา')).parentElement!;
      const aov = screen.getByText('AOV จากโฆษณา').parentElement!;
      expect(within(orders).getByText('51')).toBeVisible();
      expect(within(aov).getByText('฿1,133.73')).toBeVisible();
      const adSales = screen.getByText('ยอดขายจากโฆษณา').parentElement!;
      expect(adSales).toHaveTextContent('฿57,820.00');
      expect(screen.queryByText('฿960,000')).toBeNull();
      const financialCommission = screen.getByText('คอมมิชชันจากยอดขาย').parentElement!;
      expect(financialCommission).toHaveTextContent(attribution === 'content' ? '฿12,800' : '—');
      expect(screen.queryByText('ออเดอร์ที่สร้างคอมมิชชัน')).toBeNull();
      expect(screen.queryByText('สถานะรายได้')).toBeNull();
      expect(within(aov).queryByText('฿18,823.53')).toBeNull();
    },
  );

  it.each(['absent', 'unavailable', 'stale', 'stale-empty'] as const)(
    'keeps uniform ad hero tiles honest for a %s report',
    async (state) => {
      const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
      const report = performance();
      report.metrics = [
        metric('platform_orders', '51', 'count'),
        metric('platform_value', '57820', 'money'),
      ];
      report.series = [];
      if (state !== 'absent') report.state = state === 'stale-empty' ? 'stale' : state;
      if (state === 'stale-empty') report.metrics = [];
      if (state === 'unavailable') {
        report.metrics = [];
        report.reasons = ['ยังไม่มีรายงานในช่วงนี้'];
      }
      const transport: ContentTransport = async (request) => {
        const data = contentFixture(request);
        return request.resource === 'detail'
          ? {
              ...data,
              data: { ...data.data, performance: state === 'absent' ? undefined : report },
            }
          : data;
      };
      render(
        <ScopedQueryProvider scope={scope}>
          <ContentDetail
            scope={scope}
            context={initialReportContext}
            transport={transport}
            routes={{ content: '/content-preview', overview: '/overview-preview' }}
            canViewAdSpend={false}
            contentId="clip-1"
          />
        </ScopedQueryProvider>,
      );
      const orders = (await screen.findByText('ออเดอร์จากโฆษณา')).parentElement!;
      const aov = screen.getByText('AOV จากโฆษณา').parentElement!;
      const sales = screen.getByText('ยอดขายจากโฆษณา').parentElement!;
      if (state === 'stale') {
        expect(orders).toHaveTextContent('51');
        expect(sales).toHaveTextContent('฿57,820.00');
        expect(aov).toHaveTextContent('฿1,133.73');
        expect(screen.getByText('ผลโฆษณาล่าสุดที่บันทึกไว้')).toBeVisible();
      } else {
        expect(orders.querySelector('strong')).toHaveTextContent('—');
        expect(sales.querySelector('strong')).toHaveTextContent('—');
        expect(sales.querySelector('strong')).toHaveAttribute('aria-label');
        expect(aov.querySelector('strong')).toHaveTextContent('—');
        const reason = state === 'stale-empty' ? 'ยังไม่มีจำนวนออเดอร์' : 'ยังไม่มีข้อมูลโฆษณา';
        expect(within(orders).getByText(reason)).toBeVisible();
        expect(within(aov).getByText(reason)).toBeVisible();
        expect(within(orders).getByLabelText(reason)).toHaveTextContent('—');
        expect(within(aov).getByLabelText(reason)).toHaveTextContent('—');
        expect(screen.queryByText('ผลโฆษณาล่าสุดที่บันทึกไว้')).toBeNull();
      }
    },
  );
});
