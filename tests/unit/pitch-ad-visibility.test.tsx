import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { overviewFixture } from '../../dev/overview-transport';
import { contentFixture } from '../../dev/content-transport';
import { ContentDetailResponse } from '@/contracts/content';
import { defaultOverviewFilters as filters } from '@/features/overview/model';
import { EarningsSummary } from '@/features/overview/EarningsSummary';
import { overviewPageStatus } from '@/features/overview/overview-status';
import { ApplicationPresentationContext } from '@/shared/routing/ApplicationPresentation';
import { ContentDetail } from '@/features/content/ContentDetail';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { initialReportContext as context } from '@/shared/routing/report-context';
import { pitchConnectedAdNoticesVisible } from '@/server/platform/pitch-mode';
import type { ReactNode } from 'react';
const reason = 'รอยืนยันอัตราคอมมิชชันของโฆษณานี้';
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const routes = { content: '/content', overview: '/overview' };
function wrap(show: boolean, child: ReactNode) {
  return (
    <ApplicationPresentationContext.Provider
      value={{ resolveHref: (h) => h, showConnectedAdNotices: show }}
    >
      {child}
    </ApplicationPresentationContext.Provider>
  );
}
function overview() {
  const data = overviewFixture(filters);
  data.dataState = 'partial';
  data.reasons = [reason];
  data.accountingStatus = { state: 'ready', reasons: [] };
  data.earnings.estimated = null;
  data.earnings.connectedAdEarnings = [
    {
      amount: null,
      sales: null,
      ratePpm: null,
      status: 'estimated',
      reason,
      clipId: 'clip-3',
      title: 'Linked clip',
      fetchedAt: null,
    },
  ];
  return data;
}
describe('pitch ad notices only', () => {
  it('requires explicit local pitch opt-in', () => {
    const env = { NODE_ENV: 'development' as const, LABSD_PRESENTATION_MODE: 'pitch' };
    for (const value of [undefined, '0', 'true', ''])
      expect(pitchConnectedAdNoticesVisible({ ...env, LABSD_PITCH_SHOW_AD_NOTICES: value })).toBe(
        false,
      );
    expect(pitchConnectedAdNoticesVisible({ ...env, LABSD_PITCH_SHOW_AD_NOTICES: '1' })).toBe(true);
    expect(
      pitchConnectedAdNoticesVisible({
        ...env,
        NODE_ENV: 'production',
        LABSD_PITCH_SHOW_AD_NOTICES: '1',
      }),
    ).toBe(false);
  });
  it('localizes ad notices by provenance without suppressing accounting warnings', () => {
    const data = overview();
    expect(overviewPageStatus(data)).toEqual({ state: 'ready', reasons: [] });
    const base = { state: 'partial' as const, reasons: [reason, 'ข้อมูลรายได้ไม่ครบ'] };
    expect(overviewPageStatus({ ...data, accountingStatus: base })).toEqual(base);
    expect(overviewPageStatus({ ...data, accountingStatus: undefined })).toEqual({
      state: 'partial',
      reasons: [reason],
    });
    expect(overviewPageStatus({ ...data, dataState: 'stale' })).toEqual({
      state: 'stale',
      reasons: [reason],
    });
  });
  it('keeps overview insights and pending data stable across the ad notice flag', () => {
    const data = overview(),
      before = JSON.stringify(data);
    const child = <EarningsSummary data={data} filters={filters} />;
    const view = render(wrap(false, child));
    const original = view.container.innerHTML;
    expect(screen.getByText('คอมมิชชันรอยืนยัน')).toBeVisible();
    expect(screen.getByRole('region', { name: 'ไอเดียสำหรับคลิปถัดไป' })).toBeVisible();
    expect(screen.queryByText(/ค่าคอมจากโฆษณาที่เชื่อมต่อ/)).toBeNull();
    expect(screen.queryByText(/Linked clip/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    view.rerender(wrap(true, child));
    expect(screen.queryByRole('status')).toBeNull();
    expect(view.container.innerHTML).toBe(original);
    view.rerender(wrap(false, child));
    expect(view.container.innerHTML).toBe(original);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('keeps approved clip KPIs and ad disclosures identical with notices off or on', async () => {
    const data = ContentDetailResponse.parse(
      contentFixture({ scope, context, resource: 'detail', contentId: 'clip-1' }),
    );
    data.data.adCommission = {
      amount: null,
      sales: null,
      ratePpm: null,
      status: 'estimated',
      reason,
    };
    const child = (
      <ScopedQueryProvider scope={scope}>
        <ContentDetail
          scope={scope}
          context={context}
          routes={routes}
          contentId="clip-1"
          canViewAdSpend={false}
          transport={async () => data}
        />
      </ScopedQueryProvider>
    );
    const view = render(wrap(false, child));
    expect(await screen.findByText('ยอดขายจากโฆษณา')).toBeVisible();
    expect(screen.getByText('ออเดอร์จากโฆษณา')).toBeVisible();
    expect(screen.getByText('AOV จากโฆษณา')).toBeVisible();
    expect(screen.getByText(/โฆษณาที่ใช้คลิปนี้/)).toBeVisible();
    const original = view.container.innerHTML;
    view.rerender(wrap(true, child));
    expect(view.container.innerHTML).toBe(original);
  });
});
