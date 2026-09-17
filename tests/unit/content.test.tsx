import { beforeEach as featureBeforeEach, afterEach as featureAfterEach } from 'vitest';
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { contentFixture, createContentTransport } from '../../dev/content-transport';
import { previewVideoRead } from '../../dev/shop-video-transport';
import { overviewFixture } from '../../dev/overview-transport';
import {
  loadContent,
  type ContentRequest,
  type ContentTransport,
  type ContentResponse,
} from '@/features/content/model';
import { ContentDetail } from '@/features/content/ContentDetail';
import { PageTitleActionsTarget } from '@/shared/ui/PageTitleActions';
import { MobileHeaderActionsContext } from '@/shared/ui/MobileHeaderActions';
import { ContentList } from '@/features/content/ContentList';
import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import { AccessLost } from '@/shared/query/revision-watcher';
import { EarningsSection } from '@/features/content/EarningsSection';
import { AdList } from '@/features/content/AdList';
import { AdDetail } from '@/features/content/AdDetail';
import { MetricSections } from '@/features/content/MetricDefinition';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { ContentDetailResponse } from '@/contracts/content';
import {
  initialReportContext as context,
  readReportContext,
  reportSearch,
  reportHref,
  changeReportFilters,
} from '@/shared/routing/report-context';
const scope = { userId: 'test-user', partnerId: 'test-partner', permissionRevision: '1' };
const routes = { content: '/content-preview', overview: '/overview-preview' };
const request = <K extends ContentRequest['resource']>(
  resource: K,
  extra: Partial<Omit<ContentRequest, 'resource'>> = {},
): ContentRequest & { resource: K } => ({
  resource,
  scope,
  context,
  contentId: 'clip-1',
  adId: 'clip-1-ad-1',
  signal: new AbortController().signal,
  ...extra,
});
const transport: ContentTransport = async (r) => contentFixture(r);
const wrap = (ui: React.ReactNode) => <ScopedQueryProvider scope={scope}>{ui}</ScopedQueryProvider>;
const props = { scope, context, routes, transport, canViewAdSpend: false, contentId: 'clip-1' };
function openDetails(text: string) {
  const details = screen.getByText(text).closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
}
describe('F05 reporting context and source boundaries', () => {
  it('moves desktop back links into the heading target, empties it on mobile and cleans up on unmount', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const c = { ...context, origin: 'overview' as const };
    const page = (mobile: boolean) =>
      wrap(
        <MobileHeaderActionsContext.Provider
          value={{
            mobile,
            calendarTarget: null,
            setCalendarTarget: () => {},
            profile: null,
            setProfile: () => {},
          }}
        >
          <PageTitleActionsTarget.Provider value={target}>
            <ContentDetail {...props} context={c} />
          </PageTitleActionsTarget.Provider>
        </MobileHeaderActionsContext.Provider>,
      );
    const view = render(page(false));
    try {
      const card = (await screen.findByText('฿12,800')).closest('article')!;
      expect(within(target).getByRole('link', { name: 'กลับภาพรวม' })).toHaveAttribute(
        'href',
        reportHref(routes.overview, c),
      );
      expect(within(target).getByRole('link', { name: 'ดูคลิปทั้งหมด' })).toHaveAttribute(
        'href',
        reportHref(routes.content, { ...c, origin: 'content' }),
      );
      view.rerender(page(true));
      expect(target).toBeEmptyDOMElement();
      expect(within(card).getByRole('link', { name: 'กลับภาพรวม' })).toHaveAttribute(
        'href',
        reportHref(routes.overview, c),
      );
      view.rerender(page(false));
      expect(within(target).getByRole('link', { name: 'กลับภาพรวม' })).toBeInTheDocument();
      view.unmount();
      expect(target).toBeEmptyDOMElement();
    } finally {
      view.unmount();
      target.remove();
    }
  });

  it('keeps explicit scoped back and library destinations inside the ready clip card', async () => {
    const c = { ...context, origin: 'overview' as const, q: 'saved search' };
    render(wrap(<ContentDetail {...props} context={c} />));
    const amount = await screen.findByText('฿12,800');
    const card = amount.closest('article')!;
    expect(within(card).getByRole('link', { name: 'กลับภาพรวม' })).toHaveAttribute(
      'href',
      reportHref(routes.overview, c),
    );
    expect(within(card).getByRole('link', { name: 'ดูคลิปทั้งหมด' })).toHaveAttribute(
      'href',
      reportHref(routes.content, { ...c, origin: 'content' }),
    );
  });
  it('retains its external back destination while loading and when the envelope suppresses cards', async () => {
    let finish!: (value: unknown) => void;
    const pending: ContentTransport = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const view = render(wrap(<ContentDetail {...props} transport={pending} />));
    expect(screen.getByRole('link', { name: 'กลับคลังคลิป' })).toHaveAttribute(
      'href',
      reportHref(routes.content, context),
    );
    expect(view.container.querySelector('article')).toBeNull();
    const unavailable = contentFixture(request('detail'), 'unavailable');
    await act(async () => finish(unavailable));
    await screen.findByText(unavailable.reasons.join(' · '));
    expect(screen.getAllByRole('link', { name: 'กลับคลังคลิป' })).toHaveLength(1);
    expect(view.container.querySelector('article')).toBeNull();
  });

  it('round trips date, brand, search, cursor history, origin and generation through clip and ad links', () => {
    const c = {
      ...context,
      brand: 'Axtion',
      q: 'เช้า',
      cursor: 'offset-4',
      history: [null, 'offset-2'],
      generation: '1',
      origin: 'overview' as const,
    };
    for (const path of ['/content/clip-1', '/content/clip-1/ads/ad-1', '/overview']) {
      expect(
        readReportContext(new URL(reportHref(path, c), 'https://local.test').searchParams),
      ).toEqual(c);
    }
    expect(changeReportFilters(c, { brand: 'Tendrix' })).toMatchObject({
      brand: 'Tendrix',
      cursor: null,
      history: [],
      generation: null,
      q: 'เช้า',
    });
    expect(
      readReportContext(new URLSearchParams('history=oops&origin=https://evil.test')).origin,
    ).toBe('content');
    expect(reportSearch(c)).not.toContain('obligationAsOf');
  });
  it('rejects invalid filters before requesting data', async () => {
    const send = vi.fn(transport);
    await expect(
      loadContent(send, request('list', { context: { ...context, from: '2026-09-02' } })),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects wrong generation, period, identity, brand and duplicate rows', async () => {
    await expect(
      loadContent(
        async (r) => contentFixture(r, 'generation-changed'),
        request('detail', { context: { ...context, generation: '1' } }),
      ),
    ).rejects.toMatchObject({ code: 'generation_changed' });
    const detail = await loadContent(transport, request('detail'));
    for (const changed of [
      { ...detail, period: { ...detail.period, from: '2026-08-01T00:00:00+07:00' } },
      {
        ...detail,
        data: { ...detail.data, content: { ...detail.data.content, id: 'another-clip' } },
      },
    ])
      await expect(loadContent(async () => changed, request('detail'))).rejects.toMatchObject({
        code: 'invalid_response',
      });
    await expect(
      loadContent(
        async () => detail,
        request('detail', { context: { ...context, brand: 'Tendrix' } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    const list = await loadContent(transport, request('list'));
    await expect(
      loadContent(
        async () => ({
          ...list,
          data: { ...list.data, items: [list.data.items[0], list.data.items[0]] },
        }),
        request('list'),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('rejects cross-clip ads and earnings, including wrong earned date', async () => {
    const ad = await loadContent(transport, request('ad'));
    await expect(
      loadContent(
        async () => ({ ...ad, data: { ...ad.data, contentId: 'clip-2' } }),
        request('ad'),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    const ads = await loadContent(transport, request('ads'));
    await expect(
      loadContent(
        async () => ({
          ...ads,
          data: { ...ads.data, items: [{ ...ads.data.items[0], contentId: 'clip-2' }] },
        }),
        request('ads'),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    const earnings = await loadContent(transport, request('earnings'));
    for (const patch of [
      { contentId: 'clip-2' },
      { earnedAt: '2026-09-01T00:00:00+07:00' },
      { contentId: null, attribution: 'partner-only' },
    ]) {
      await expect(
        loadContent(
          async () => ({
            ...earnings,
            data: { ...earnings.data, items: [{ ...earnings.data.items[0], ...patch }] },
          }),
          request('earnings'),
        ),
      ).rejects.toMatchObject({ code: 'invalid_response' });
    }
  });
  it('all paginated clip amounts plus unassigned reconcile to Overview across brand/date/adjustments', async () => {
    for (const mode of ['ready', 'partial', 'adjustments', 'empty'] as const)
      for (const c of [
        context,
        { ...context, brand: 'Axtion' },
        { ...context, from: '2026-08-25' },
      ]) {
        let cursor: string | null = null,
          sum = 0n;
        const covers = new Set<string>();
        do {
          const page: ContentResponse<'list'> = await loadContent(
            async (r) => contentFixture(r, mode),
            request('list', { context: c, cursor }),
          );
          for (const clip of page.data.items) {
            sum += BigInt(clip.earned?.minor ?? '0');
            if (clip.cover) covers.add(clip.cover);
          }
          cursor = page.data.nextCursor;
        } while (cursor);
        const overview = overviewFixture(c, mode);
        expect(sum + BigInt(overview.earnings.unassignedAmount!.minor)).toBe(
          BigInt(overview.earnings.confirmed!.minor),
        );
        if (mode === 'ready' && c === context) expect(covers.size).toBe(6);
      }
  });
  it('keeps unknown status unknown on older wire payloads and cannot infer period views from lifetime views', async () => {
    const detail = await loadContent(transport, request('detail'));
    const { earningsStatus, ...older } = detail.data;
    expect(ContentDetailResponse.parse({ ...detail, data: older }).data.earningsStatus).toBe(
      'unavailable',
    );
    expect(detail.data.metrics.find((m) => m.key === 'video_views')?.value).toBeNull();
    expect(detail.data.eligibleOrders).toBeNull();
  });
  it('aborts a superseded source request', async () => {
    const abort = new AbortController();
    const pending = createContentTransport('loading')(request('list', { signal: abort.signal }));
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
describe('continuous ad collection', () => {
  it.each(['network', 'unavailable'] as const)(
    'retains prior ads after a later %s failure and retries only that batch',
    async (failure) => {
      let failed = false;
      const send = vi.fn(async (r: ContentRequest) => {
        if (r.cursor && !failed) {
          failed = true;
          throw failure === 'unavailable' ? new SourceUnavailableError() : new Error('offline');
        }
        return contentFixture(r);
      });
      render(wrap(<AdList {...props} transport={send} />));
      await screen.findByText('โหลดโฆษณาเพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง');
      expect(screen.getByRole('link', { name: /วิดีโอหลัก/ })).toBeVisible();
      expect(send).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(/ช่วงข้อมูลโฆษณา|ข้อมูลถึง/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
      await screen.findByRole('link', { name: /ทดสอบข้อความ/ });
      expect(send.mock.calls.map(([r]) => r.cursor)).toEqual([null, 'offset-2', 'offset-2']);
      expect(screen.getAllByRole('link')).toHaveLength(3);
      for (const link of screen.getAllByRole('link'))
        expect(link).toHaveAttribute('href', expect.stringContaining('generation=1'));
    },
  );
  it.each(['generation', 'duplicate', 'cursor', 'access'] as const)(
    'stops unsafe %s continuation without mixing ad sets',
    async (violation) => {
      const send = vi.fn(async (r: ContentRequest) => {
        const page = contentFixture(r) as ContentResponse<'ads'>;
        if (!r.cursor) return page;
        if (violation === 'access') throw new AccessLost('scope lost');
        if (violation === 'generation') return { ...page, generation: '2' };
        if (violation === 'duplicate') return contentFixture({ ...r, cursor: null });
        return { ...page, data: { ...page.data, nextCursor: r.cursor } };
      });
      render(wrap(<AdList {...props} transport={send} />));
      await screen.findByText(
        violation === 'access'
          ? /สิทธิ์เข้าถึงข้อมูลเปลี่ยนแล้ว/
          : violation === 'generation'
            ? /มีข้อมูลรายได้รุ่นใหม่/
            : violation === 'duplicate'
              ? /ต้นทางส่งโฆษณาซ้ำ/
              : /ต้นทางส่งหน้าโฆษณาซ้ำ/,
      );
      expect(send).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('link', { name: /วิดีโอหลัก/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /ทดสอบข้อความ/ })).toBeNull();
    },
  );
  it.each(['partial', 'unavailable'] as const)(
    'keeps later %s notice and stops unavailable continuations',
    async (dataState) => {
      const send = vi.fn(async (r: ContentRequest) => {
        const page = contentFixture(r) as ContentResponse<'ads'>;
        return r.cursor
          ? {
              ...page,
              dataState,
              reasons: ['สถานะของชุดโฆษณาถัดไป'],
              data: {
                ...page.data,
                nextCursor: dataState === 'unavailable' ? 'must-not-fetch' : null,
              },
            }
          : page;
      });
      render(wrap(<AdList {...props} transport={send} />));
      await screen.findByText('สถานะของชุดโฆษณาถัดไป');
      expect(screen.getByRole('link', { name: /วิดีโอหลัก/ })).toBeVisible();
      expect(!!screen.queryByRole('link', { name: /ทดสอบข้อความ/ })).toBe(dataState === 'partial');
      expect(send).toHaveBeenCalledTimes(2);
    },
  );
  it('aborts and resets the collection for a new clip/window and ignores the late old batch', async () => {
    let finish!: (value: unknown) => void;
    let previous!: ContentRequest;
    const send = vi.fn(async (r: ContentRequest) => {
      if (r.contentId === 'clip-1' && r.cursor) {
        previous = r;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return contentFixture(r);
    });
    const view = render(wrap(<AdList {...props} transport={send} />));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const next = { ...context, from: '2026-08-01' };
    view.rerender(wrap(<AdList {...props} contentId="clip-2" context={next} transport={send} />));
    await screen.findByRole('link', { name: /ทดสอบข้อความ/ });
    expect(previous.signal.aborted).toBe(true);
    await act(async () => finish(contentFixture(previous)));
    expect(
      screen
        .getAllByRole('link')
        .every((link) => link.getAttribute('href')?.includes('/clip-2/ads/')),
    ).toBe(true);
    expect(send.mock.calls.filter(([r]) => r.contentId === 'clip-2')[0][0]).toMatchObject({
      cursor: null,
      context: { from: '2026-08-01', generation: null },
    });
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
});

describe('F05 frontend honesty and progressive disclosure', () => {
  it('loads only the clip summary first, then same-generation earnings and all ad batches on demand', async () => {
    const send = vi.fn(transport);
    render(wrap(<ContentDetail {...props} transport={send} />));
    await screen.findByText('฿12,800');
    expect(send.mock.calls.map(([r]) => r.resource)).toEqual(['detail']);
    expect(screen.getByText('ออเดอร์จากโฆษณา').parentElement).toHaveTextContent('—');
    expect(screen.getByText('AOV จากโฆษณา').parentElement).toHaveTextContent('—');
    openDetails('รายได้และวิธีคำนวณ');
    await screen.findAllByText(/คิดค่าคอมมิชชัน/);
    expect(send.mock.calls.find(([r]) => r.resource === 'earnings')?.[0].context.generation).toBe(
      '1',
    );
    openDetails('โฆษณาที่ใช้คลิปนี้ (3)');
    await screen.findByRole('link', { name: /วิดีโอหลัก/ });
    await screen.findByRole('link', { name: /ทดสอบข้อความ/ });
    expect(screen.getByRole('link', { name: /วิดีโอหลัก/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /กลุ่มผู้ชมเพิ่มเติม/ })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'หน้าโฆษณาของคลิป' })).toBeNull();
    const adSection = screen.getByText('โฆษณาที่ใช้คลิปนี้ (3)').closest('details')!;
    expect(within(adSection).queryByRole('button', { name: 'ถัดไป' })).toBeNull();
    expect(send.mock.calls.filter(([r]) => r.resource === 'ads')).toHaveLength(2);
    expect(send.mock.calls.filter(([r]) => r.resource === 'ads')[1][0]).toMatchObject({
      cursor: 'offset-2',
      context: { generation: '1' },
    });
  });
  it('partner-only detail never fabricates amounts or requests clip earnings', async () => {
    const send = vi.fn(async (r: ContentRequest) => contentFixture(r, 'partial'));
    render(wrap(<ContentDetail {...props} transport={send} />));
    await screen.findByText(/ต้นทางระบุรายได้ระดับพาร์ทเนอร์ ยังจับคู่กับคลิปนี้ไม่ได้/);
    expect(screen.queryByText('฿12,800')).toBeNull();
    openDetails('รายได้และวิธีคำนวณ');
    await screen.findByText(/ยังไม่สามารถแสดงรายการฐานยอดขาย/);
    expect(send.mock.calls.map(([r]) => r.resource)).toEqual(['detail']);
  });
  it.each(['ready', 'empty', 'error', 'absent'] as const)(
    'keeps %s video feedback separate from unavailable finance',
    async (mode) => {
      const send: ContentTransport = async () => {
        const fixture = await loadContent(transport, request('detail'));
        return {
          ...fixture,
          dataState: 'partial',
          data: {
            ...fixture.data,
            attribution: 'unavailable',
            earningsStatus: 'unavailable',
            metrics: [],
            eligibleSales: null,
            eligibleOrders: null,
            content: {
              ...fixture.data.content,
              earned: null,
              unavailableReason: 'ยังไม่มีรายได้ที่เผยแพร่ในช่วงวันที่เลือก',
            },
          },
        };
      };
      const video = vi.fn(async (...args: Parameters<typeof previewVideoRead>) => {
        if (mode === 'error') throw new Error('Synthetic unavailable video');
        const result = (await previewVideoRead(...args)) as Record<string, unknown>;
        return mode === 'empty' ? { ...result, items: [] } : result;
      });
      render(
        wrap(
          <ContentDetail
            {...props}
            transport={send}
            shopVideoTransport={mode === 'absent' ? undefined : video}
          />,
        ),
      );
      expect(
        await screen.findByLabelText('ยังไม่มีรายได้ที่เผยแพร่ในช่วงวันที่เลือก'),
      ).toHaveTextContent('—');
      expect(screen.queryByText('ยังจับคู่ไม่ได้')).toBeNull();
      expect(video).not.toHaveBeenCalled();
      openDetails('ประสิทธิภาพคลิป');
      if (mode === 'ready') {
        await screen.findByText('43,001.00 THB');
        expect(screen.queryByText('ยอดดูวิดีโอ')).toBeNull();
      }
      if (mode === 'empty')
        await screen.findByText('ยังไม่มีรายงาน TikTok Shop Video สำหรับคลิปนี้ในช่วงที่เลือก');
      if (mode === 'error')
        await screen.findByText('ข้อมูล TikTok ยังไม่พร้อม หรือสิทธิ์การเข้าถึงเปลี่ยนแล้ว');
      if (mode === 'absent')
        expect(screen.getByText('ยังไม่มีข้อมูลประสิทธิภาพจากต้นทาง')).toBeVisible();
      else expect(screen.queryByText('ยังไม่มีข้อมูลประสิทธิภาพจากต้นทาง')).toBeNull();
      expect(screen.queryByText('฿12,800')).toBeNull();
      openDetails('รายได้และวิธีคำนวณ');
      expect(screen.queryByText(/จนกว่าจะมีหลักฐานจับคู่จากต้นทาง/)).toBeNull();
    },
  );
  it('removed cover has a placeholder while historical earnings remain', async () => {
    render(
      wrap(<ContentDetail {...props} transport={async (r) => contentFixture(r, 'removed')} />),
    );
    await screen.findByText('฿12,800');
    expect(
      screen.getByText('คลิปถูกนำออกแล้ว ประวัติรายได้ที่ตรวจสอบได้ยังแสดงอยู่'),
    ).toBeVisible();
    expect(screen.queryByRole('img', { name: /พูดตรง/ })).toBeNull();
  });
  it('generation change prevents displaying mismatched amounts and offers latest overview', async () => {
    render(
      wrap(
        <ContentDetail
          {...props}
          context={{ ...context, generation: '1', brand: 'Axtion' }}
          transport={async (r) => contentFixture(r, 'generation-changed')}
        />,
      ),
    );
    const link = await screen.findByRole('link', { name: 'เปิดภาพรวมล่าสุด' });
    expect(link.getAttribute('href')).toContain('brand=Axtion');
    expect(link.getAttribute('href')).not.toContain('generation=');
    expect(screen.queryByText('฿12,800')).toBeNull();
  });
  it('unavailable data hides old fixture amounts; failed first request can retry', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockImplementation(async (r: ContentRequest) => contentFixture(r, 'unavailable'));
    render(wrap(<ContentDetail {...props} transport={send} />));
    fireEvent.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('ต้นทางยังไม่พร้อมให้ข้อมูล')).toBeVisible();
    expect(screen.queryByText('฿12,800')).toBeNull();
    expect(screen.queryByText('฿0')).toBeNull();
  });
  it('ad metrics show ROAS, gate spend, and omit audience counts without repeating clip earnings', async () => {
    render(wrap(<AdDetail {...props} adId="clip-1-ad-1" />));
    await screen.findByText('ROAS');
    expect(screen.getByText('คลิกลิงก์').closest('article')).toHaveTextContent('1,240');
    expect(screen.queryByText('ค่าโฆษณา')).toBeNull();
    expect(screen.queryByText('81,200')).toBeNull();
    expect(screen.queryByText('฿12,800')).toBeNull();
    expect(screen.queryByText('ผู้ชมไม่ซ้ำ')).toBeNull();
    expect(screen.getByText('ผลลัพธ์ที่แพลตฟอร์มรายงาน')).toBeVisible();
    const data = await loadContent(transport, request('ad'));
    render(<MetricSections metrics={data.data.metrics} canViewAdSpend />);
    expect(screen.getByText('ค่าโฆษณา')).toBeVisible();
    expect(screen.getAllByText('ROAS')).toHaveLength(2);
    expect(screen.getByText('฿9,000.00')).toBeVisible();
  });
  it('all six clips share one page, search preserves context and redundant filter actions are absent', async () => {
    const onChange = vi.fn();
    render(wrap(<ContentList {...props} brands={['Axtion']} onChange={onChange} />));
    await screen.findByText('฿12,800');
    expect(
      screen
        .getAllByRole('link')
        .filter((x) => x.getAttribute('href')?.startsWith('/content-preview/clip-')),
    ).toHaveLength(6);
    expect(screen.queryByRole('button', { name: 'ถัดไป' })).toBeNull();
    fireEvent.change(screen.getByLabelText('ค้นหาคลิปหรือแบรนด์'), {
      target: { value: ' Axtion ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหา' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...context, q: 'Axtion' });
    expect(screen.queryByRole('button', { name: 'รีเซ็ตตัวกรอง' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'อัปเดตคลังคลิป' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'เดือน 1' }), {
      target: { value: '08' },
    });
    fireEvent.click(
      within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' })).getByRole('button', {
        name: '2026-08-01',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...context,
      from: '2026-08-01',
      generation: null,
      cursor: null,
      history: [],
    });
  });
  it('keeps older catalogue clips discoverable and links the selected income window', async () => {
    const window = { ...context, from: '2026-09-01', toExclusive: '2026-09-10' };
    const preview = await loadContent(transport, request('list', { context: window }));
    expect(preview.data.items).toHaveLength(6);
    const noPublishedIncome: ContentTransport = async (r) => {
      const fixture = await loadContent(transport, { ...r, resource: 'list' });
      return {
        ...fixture,
        dataState: 'partial',
        dataThrough: null,
        reasons: ['ยังไม่มีรายได้ที่เผยแพร่ในช่วงวันที่เลือก'],
        data: {
          ...fixture.data,
          items: fixture.data.items.map((clip) => ({
            ...clip,
            earned: null,
            unavailableReason: 'ยังไม่มีรายได้ที่เผยแพร่ในช่วงวันที่เลือก',
          })),
        },
      };
    };
    render(
      wrap(
        <ContentList
          {...props}
          context={window}
          transport={noPublishedIncome}
          brands={[]}
          onChange={vi.fn()}
        />,
      ),
    );
    await screen.findByRole('link', { name: /พูดตรง ๆ ตัวนี้ช่วยให้เช้าวันทำงานง่ายขึ้น/ });
    const links = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/content-preview/clip-'));
    expect(links).toHaveLength(6);
    expect(links.every((link) => link.getAttribute('href')?.includes('from=2026-09-01'))).toBe(
      true,
    );
    expect(screen.queryByText('฿0')).toBeNull();
    expect(screen.queryByText('฿12,800')).toBeNull();
  });
  it('appends source batches automatically and pins their generation without page controls', async () => {
    const full = await loadContent(transport, request('list'));
    const send = vi.fn(async (r: ContentRequest) => ({
      ...full,
      data: {
        ...full.data,
        items: r.cursor ? full.data.items.slice(3) : full.data.items.slice(0, 3),
        nextCursor: r.cursor ? null : 'next-batch',
      },
    }));
    render(
      wrap(<ContentList {...props} transport={send} brands={['Axtion']} onChange={vi.fn()} />),
    );
    await screen.findByText('฿1,860');
    expect(
      screen
        .getAllByRole('link')
        .filter((x) => x.getAttribute('href')?.startsWith('/content-preview/clip-')),
    ).toHaveLength(6);
    expect(send.mock.calls[1][0]).toMatchObject({
      cursor: 'next-batch',
      context: { generation: '1' },
    });
    expect(screen.queryByRole('button', { name: 'ถัดไป' })).toBeNull();
  });
  it('matches partial brand and Thai title while typing, and clearing restores the library', async () => {
    function Library() {
      const [filters, setFilters] = useState(context);
      return <ContentList {...props} context={filters} brands={[]} onChange={setFilters} />;
    }
    render(wrap(<Library />));
    const clips = () =>
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.startsWith('/content-preview/clip-'));
    await waitFor(() => expect(clips()).toHaveLength(6));
    const input = screen.getByLabelText('ค้นหาคลิปหรือแบรนด์');
    fireEvent.change(input, { target: { value: 'tend' } });
    await waitFor(() => expect(clips()).toHaveLength(1));
    expect(clips()[0]).toHaveAttribute('href', expect.stringContaining('/clip-3?'));
    fireEvent.change(input, { target: { value: 'เช้า' } });
    await waitFor(() =>
      expect(clips()[0]).toHaveAttribute('href', expect.stringContaining('/clip-1?')),
    );
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(clips()).toHaveLength(6));
  });
  it('debounces bursts, waits for composition, and cancels pending search after external reset or unmount', async () => {
    const onChange = vi.fn();
    const mounted = render(wrap(<ContentList {...props} brands={[]} onChange={onChange} />));
    await screen.findByText('฿12,800');
    vi.useFakeTimers();
    try {
      const input = screen.getByLabelText('ค้นหาคลิปหรือแบรนด์');
      fireEvent.change(input, { target: { value: 't' } });
      act(() => vi.advanceTimersByTime(200));
      fireEvent.change(input, { target: { value: 'te' } });
      act(() => vi.advanceTimersByTime(249));
      expect(onChange).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...context, q: 'te' });
      onChange.mockClear();
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: 'เช้า' } });
      act(() => vi.advanceTimersByTime(500));
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input);
      act(() => vi.advanceTimersByTime(250));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...context, q: 'เช้า' });
      onChange.mockClear();
      fireEvent.change(input, { target: { value: 'discard me' } });
      mounted.rerender(
        wrap(
          <ContentList
            {...props}
            context={{ ...context, q: 'Axtion' }}
            brands={[]}
            onChange={onChange}
          />,
        ),
      );
      expect(input).toHaveValue('Axtion');
      act(() => vi.advanceTimersByTime(500));
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'discard on unmount' } });
      mounted.unmount();
      act(() => vi.advanceTimersByTime(500));
      expect(onChange).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('opens compact search with focus, preserves IME and query on close, and clears through the same debounce', async () => {
    const onChange = vi.fn();
    render(
      wrap(
        <ContentList
          {...props}
          context={{ ...context, q: 'Tendrix' }}
          brands={[]}
          onChange={onChange}
        />,
      ),
    );
    await screen.findByText('฿9,600');
    const input = screen.getByLabelText('ค้นหาคลิปหรือแบรนด์');
    const form = input.closest('form')!;
    const trigger = screen.getByRole('button', { name: 'ค้นหาคลิป: Tendrix' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(input).toHaveFocus();
    expect(form).toHaveAttribute('data-expanded', 'true');
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(form).toHaveAttribute('data-expanded', 'false');
    fireEvent.click(trigger);
    expect(input).toHaveFocus();
    vi.useFakeTimers();
    try {
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: 'เช้า' } });
      fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
      act(() => vi.advanceTimersByTime(500));
      expect(onChange).not.toHaveBeenCalled();
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(input).toHaveFocus();
      fireEvent.compositionEnd(input);
      act(() => vi.advanceTimersByTime(250));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...context, q: 'เช้า' });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAccessibleName('ค้นหาคลิป: เช้า');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(input).toHaveValue('เช้า');
      fireEvent.click(trigger);
      expect(input).toHaveFocus();
      expect(screen.getByLabelText('ค้นหาคลิปหรือแบรนด์')).toBe(input);
      onChange.mockClear();
      // Native search-input clearing emits the same change event as typing.
      fireEvent.change(input, { target: { value: '' } });
      expect(input).toHaveFocus();
      expect(input).toHaveValue('');
      act(() => vi.advanceTimersByTime(250));
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...context, q: '' });
      fireEvent.click(trigger);
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAccessibleName('เปิดช่องค้นหาคลิป');
      expect(form).toHaveAttribute('data-expanded', 'false');
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps an already focused desktop search expanded when its card becomes compact', async () => {
    render(wrap(<ContentList {...props} brands={[]} onChange={vi.fn()} />));
    await screen.findByText('฿12,800');
    const input = screen.getByLabelText('ค้นหาคลิปหรือแบรนด์');
    fireEvent.focus(input);
    expect(input.closest('form')).toHaveAttribute('data-expanded', 'true');
    expect(input).toHaveFocus();
    const trigger = screen.getByRole('button', { name: 'เปิดช่องค้นหาคลิป' });
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element === trigger
        ? ({ display: 'none' } as CSSStyleDeclaration)
        : computedStyle(element, pseudo),
    );
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.closest('form')).toHaveAttribute('data-expanded', 'true');
    expect(input).toHaveFocus();
  });
  it('late results from an older typed search cannot replace the latest matches', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const send = vi.fn(
      (r: ContentRequest) => new Promise((resolve) => pending.set(r.context.q, resolve)),
    );
    function Library() {
      const [filters, setFilters] = useState(context);
      return (
        <ContentList
          {...props}
          transport={send}
          context={filters}
          brands={[]}
          onChange={setFilters}
        />
      );
    }
    render(wrap(<Library />));
    const input = screen.getByLabelText('ค้นหาคลิปหรือแบรนด์');
    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => expect(pending.has('a')).toBe(true));
    fireEvent.change(input, { target: { value: 'tend' } });
    await waitFor(() => expect(pending.has('tend')).toBe(true));
    await act(async () =>
      pending.get('tend')!(contentFixture(request('list', { context: { ...context, q: 'tend' } }))),
    );
    await screen.findByText('฿9,600');
    await act(async () =>
      pending.get('a')!(contentFixture(request('list', { context: { ...context, q: 'a' } }))),
    );
    expect(screen.queryByText('฿12,800')).toBeNull();
    expect(input).toHaveValue('tend');
  });
  it('rejects duplicates across batches instead of duplicating clip income', async () => {
    const full = await loadContent(transport, request('list'));
    const send = vi.fn(async (r: ContentRequest) => ({
      ...full,
      data: {
        ...full.data,
        items: full.data.items.slice(0, 1),
        nextCursor: r.cursor ? null : 'next-batch',
      },
    }));
    render(wrap(<ContentList {...props} transport={send} brands={[]} onChange={vi.fn()} />));
    await screen.findByText('ต้นทางส่งคลิปซ้ำระหว่างชุดข้อมูล กรุณาโหลดคลังคลิปใหม่');
    expect(screen.queryByText('฿12,800')).toBeNull();
  });
  it('late source replies cannot overwrite a newly selected brand', async () => {
    const pending = new Map<string, (v: unknown) => void>();
    const send = vi.fn(
      (r: ContentRequest) =>
        new Promise((resolve) => pending.set(r.context.brand ?? 'all', resolve)),
    );
    const { rerender } = render(
      wrap(<ContentList {...props} transport={send} brands={['Axtion']} onChange={vi.fn()} />),
    );
    await waitFor(() => expect(pending.has('all')).toBe(true));
    const filtered = { ...context, brand: 'Axtion' };
    rerender(
      wrap(
        <ContentList
          {...props}
          context={filtered}
          transport={send}
          brands={['Axtion']}
          onChange={vi.fn()}
        />,
      ),
    );
    await waitFor(() => expect(pending.has('Axtion')).toBe(true));
    pending.get('Axtion')!(contentFixture(request('list', { context: filtered })));
    await screen.findByText('฿12,800');
    pending.get('all')!(contentFixture(request('list')));
    await waitFor(() => expect(screen.queryByText('฿9,600')).toBeNull());
    expect(
      screen
        .getAllByRole('link')
        .filter((x) => x.getAttribute('href')?.startsWith('/content-preview/clip-')),
    ).toHaveLength(2);
  });
});

// The legacy brand workflows remain available behind the opt-in flag.
featureBeforeEach(() => vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true'));
featureAfterEach(() => vi.unstubAllEnvs());

featureBeforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});
featureAfterEach(() => vi.restoreAllMocks());

describe('continuous clip earnings presentation', () => {
  function earningsPage(r: ContentRequest) {
    const source = contentFixture({
      ...r,
      resource: 'earnings',
      cursor: null,
    }) as ContentResponse<'earnings'>;
    const last = Boolean(r.cursor);
    return {
      ...source,
      data: {
        ...source.data,
        items: [
          {
            ...source.data.items[0],
            id: last ? 'line-last' : 'line-first',
            amount: { currency: 'THB' as const, minor: last ? '45678' : '12345' },
          },
        ],
        nextCursor: last ? null : 'offset-2',
      },
    };
  }
  it('appends exact rows without pagination, freshness or opaque reference IDs', async () => {
    const send = vi.fn(async (r: ContentRequest) => earningsPage(r));
    render(wrap(<EarningsSection {...props} transport={send} />));
    await screen.findByText('฿456.78');
    expect(screen.getByText('฿123.45')).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'หน้ารายการรายได้' })).toBeNull();
    expect(
      screen.queryByText(/ช่วงรายได้|ข้อมูลถึง|รายการจากต้นทางในรุ่น|ข้อตกลงเวอร์ชัน|หลักฐาน /),
    ).toBeNull();
    const conditions = screen.getAllByText('เงื่อนไขค่าคอมมิชชัน')[0].closest('details')!;
    conditions.open = true;
    expect(
      within(conditions).getByText(/คิดค่าคอมมิชชัน .*% จากยอดขายที่เข้าเงื่อนไข/),
    ).toBeVisible();
    expect(send.mock.calls.map(([r]) => r.cursor)).toEqual([null, 'offset-2']);
    expect(send.mock.calls[1][0].context.generation).toBe('1');
  });
  it('keeps earlier rows after a later network failure and retries only the failed continuation', async () => {
    let failed = false;
    const send = vi.fn(async (r: ContentRequest) => {
      if (r.cursor && !failed) {
        failed = true;
        throw new Error('network');
      }
      return earningsPage(r);
    });
    render(wrap(<EarningsSection {...props} transport={send} />));
    await screen.findByText('โหลดรายการรายได้เพิ่มเติมไม่สำเร็จ กรุณาลองอีกครั้ง');
    expect(screen.getByText('฿123.45')).toBeVisible();
    expect(send).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    await screen.findByText('฿456.78');
    expect(send.mock.calls.map(([r]) => r.cursor)).toEqual([null, 'offset-2', 'offset-2']);
  });
  it('hides prior rows when a continuation changes generation', async () => {
    const send = vi.fn(async (r: ContentRequest) => ({
      ...earningsPage(r),
      generation: r.cursor ? '2' : '1',
    }));
    render(wrap(<EarningsSection {...props} transport={send} />));
    await screen.findByText(/มีข้อมูลรายได้รุ่นใหม่/);
    expect(screen.queryByText('฿123.45')).toBeNull();
    expect(screen.queryByText('฿456.78')).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('resets on clip change and ignores the aborted previous continuation', async () => {
    let finish!: (value: unknown) => void;
    let old!: ContentRequest;
    const send = vi.fn(async (r: ContentRequest) => {
      if (r.contentId === 'clip-1' && r.cursor) {
        old = r;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      const page = earningsPage(r);
      return r.contentId === 'clip-2'
        ? {
            ...page,
            data: {
              ...page.data,
              nextCursor: null,
              items: page.data.items.map((line) => ({
                ...line,
                amount: { currency: 'THB', minor: '88888' },
              })),
            },
          }
        : page;
    });
    const view = render(wrap(<EarningsSection {...props} transport={send} />));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    view.rerender(wrap(<EarningsSection {...props} contentId="clip-2" transport={send} />));
    await screen.findByText('฿888.88');
    expect(old.signal.aborted).toBe(true);
    await act(async () => finish(earningsPage(old)));
    expect(screen.queryByText('฿123.45')).toBeNull();
    expect(screen.queryByText('฿456.78')).toBeNull();
    expect(send.mock.calls[2][0]).toMatchObject({
      contentId: 'clip-2',
      cursor: null,
      context: { generation: null },
    });
  });
});
