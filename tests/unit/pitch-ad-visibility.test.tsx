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
import { ContentCard } from '@/features/content/ContentCard';
import { AdDetail } from '@/features/content/AdDetail';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { initialReportContext as context } from '@/shared/routing/report-context';
import { pitchConnectedAdsVisible } from '@/server/platform/pitch-mode';
import type { ReactNode } from 'react';
const reason = 'รอยืนยันอัตราคอมมิชชันของโฆษณานี้';
const commission = {
  amount: null,
  sales: null,
  ratePpm: null,
  reason,
  status: 'estimated' as const,
};
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const routes = { content: '/content', overview: '/overview' };
function wrap(show: boolean, child: ReactNode) {
  return (
    <ApplicationPresentationContext.Provider
      value={{ resolveHref: (h) => h, showConnectedAds: show }}
    >
      {child}
    </ApplicationPresentationContext.Provider>
  );
}
function overview() {
  const data = overviewFixture(filters);
  data.accountingStatus = { state: 'ready', reasons: [] };
  data.dataState = 'partial';
  data.reasons = [reason];
  data.earnings.estimated = null;
  data.earnings.connectedAdEarnings = [
    { ...commission, clipId: 'clip-3', title: 'Linked clip', fetchedAt: null },
  ];
  return data;
}
describe('pitch connected-ad visibility', () => {
  it('defaults off and requires explicit local pitch opt-in', () => {
    const env = { NODE_ENV: 'development' as const, LABSD_PRESENTATION_MODE: 'pitch' };
    for (const value of [undefined, '0', 'true', ''])
      expect(pitchConnectedAdsVisible({ ...env, LABSD_PITCH_SHOW_CONNECTED_ADS: value })).toBe(
        false,
      );
    expect(pitchConnectedAdsVisible({ ...env, LABSD_PITCH_SHOW_CONNECTED_ADS: '1' })).toBe(true);
    expect(
      pitchConnectedAdsVisible({
        ...env,
        NODE_ENV: 'production',
        LABSD_PITCH_SHOW_CONNECTED_ADS: '1',
      }),
    ).toBe(false);
    expect(
      pitchConnectedAdsVisible({
        ...env,
        LABSD_PRESENTATION_MODE: '',
        LABSD_PITCH_SHOW_CONNECTED_ADS: '1',
      }),
    ).toBe(false);
  });
  it('moves only ad-specific partial reasons; preserves unrelated partial and stale notices', () => {
    const data = overview();
    expect(overviewPageStatus(data)).toEqual({ state: 'ready', reasons: [] });
    expect(
      overviewPageStatus({
        ...data,
        accountingStatus: { state: 'partial', reasons: [reason, 'ข้อมูลรายได้ไม่ครบ'] },
        reasons: [reason, 'ข้อมูลรายได้ไม่ครบ'],
      }),
    ).toEqual({
      state: 'partial',
      reasons: [reason, 'ข้อมูลรายได้ไม่ครบ'],
    });
    expect(overviewPageStatus({ ...data, dataState: 'stale' })).toEqual({
      state: 'stale',
      reasons: [reason],
    });
    expect(overviewPageStatus({ ...data, accountingStatus: undefined, reasons: [] }).state).toBe(
      'partial',
    );
  });
  it('reversibly hides linked pending earnings, keeps confirmed money and data intact', () => {
    const data = overview(),
      before = JSON.stringify(data);
    const child = <EarningsSummary data={data} filters={filters} />;
    const view = render(wrap(false, child));
    const offMoney = view.container.textContent!.match(/฿[\d,.]+/g);
    expect(screen.queryByText(reason)).toBeNull();
    expect(screen.queryByText('คอมมิชชันรอยืนยัน')).toBeNull();
    view.rerender(wrap(true, child));
    expect(screen.getByRole('status')).toHaveTextContent(reason);
    expect(view.container.textContent!.match(/฿[\d,.]+/g)).toEqual(offMoney);
    view.rerender(wrap(false, child));
    expect(screen.queryByText(reason)).toBeNull();
    expect(JSON.stringify(data)).toBe(before);
    const unrelated = {
      ...data,
      accountingStatus: { state: 'partial' as const, reasons: ['ข้อมูลรายได้ไม่ครบ'] },
    };
    expect(unrelated.earnings.connectedAdEarnings).toHaveLength(1);
    view.rerender(wrap(false, <EarningsSummary data={unrelated} filters={filters} />));
    expect(screen.getByText('ยังไม่มีข้อมูลยอดประมาณการ')).toBeVisible();
  });
  it('hides ad IDs and pending commissions without removing the clip or confirmed earnings', () => {
    const detail = ContentDetailResponse.parse(
      contentFixture({ scope, context, resource: 'detail', contentId: 'clip-1' }),
    );
    const clip = {
      ...detail.data.content,
      adCommission: commission,
      adReferences: [{ platform: 'facebook' as const, externalId: '123' }],
    };
    const child = <ContentCard clip={clip} href="/content/clip-1" />;
    const view = render(wrap(false, child));
    expect(screen.getByText(clip.title)).toBeVisible();
    expect(screen.queryByText('123')).toBeNull();
    view.rerender(wrap(true, child));
    expect(screen.getByText('123')).toBeVisible();
  });
  it('restores clip ad KPIs and disclosure on enable with the same loaded record', async () => {
    const data = ContentDetailResponse.parse(
      contentFixture({ scope, context, resource: 'detail', contentId: 'clip-1' }),
    );
    data.data.adCommission = commission;
    const before = JSON.stringify(data);
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
    expect(await screen.findByText('คอมมิชชันยืนยันแล้ว')).toBeVisible();
    expect(screen.queryByText('ยอดขายจากโฆษณา')).toBeNull();
    expect(screen.queryByText(/โฆษณาที่ใช้คลิปนี้/)).toBeNull();
    view.rerender(wrap(true, child));
    expect(screen.getByText('ยอดขายจากโฆษณา')).toBeVisible();
    expect(screen.getByText(/โฆษณาที่ใช้คลิปนี้/)).toBeVisible();
    expect(JSON.stringify(data)).toBe(before);
  });
  it('does not expose the ad report through a bookmarked ad detail when off', async () => {
    const data = contentFixture({
      scope,
      context,
      resource: 'ad',
      contentId: 'clip-1',
      adId: 'clip-1-ad-1',
    });
    render(
      wrap(
        false,
        <ScopedQueryProvider scope={scope}>
          <AdDetail
            scope={scope}
            context={context}
            routes={routes}
            contentId="clip-1"
            adId="clip-1-ad-1"
            canViewAdSpend={false}
            transport={async () => data}
          />
        </ScopedQueryProvider>,
      ),
    );
    expect(await screen.findByText('รายละเอียดโฆษณายังไม่เปิดแสดง')).toBeVisible();
    expect(screen.getByRole('link', { name: 'กลับรายละเอียดคลิป' })).toHaveAttribute(
      'href',
      expect.stringContaining('/content/clip-1'),
    );
    expect(screen.queryByText(/ผลโฆษณาจากแพลตฟอร์ม/)).toBeNull();
  });
});
