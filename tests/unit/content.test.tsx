import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { contentFixture, createContentTransport } from '../../dev/content-transport';
import { overviewFixture } from '../../dev/overview-transport';
import {
  loadContent,
  type ContentRequest,
  type ContentTransport,
  type ContentResponse,
} from '@/features/content/model';
import { ContentDetail } from '@/features/content/ContentDetail';
import { ContentList } from '@/features/content/ContentList';
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
describe('F05 frontend honesty and progressive disclosure', () => {
  it('loads only the clip summary first, then same-generation earnings and paginated ads on demand', async () => {
    const send = vi.fn(transport);
    render(wrap(<ContentDetail {...props} transport={send} />));
    await screen.findByText('฿12,800');
    expect(send.mock.calls.map(([r]) => r.resource)).toEqual(['detail']);
    expect(screen.getByText('ต้นทางยังไม่ส่งจำนวนออเดอร์')).toBeVisible();
    openDetails('รายได้และวิธีคำนวณ');
    await screen.findByText(/ฐานยอดขาย/);
    expect(send.mock.calls.find(([r]) => r.resource === 'earnings')?.[0].context.generation).toBe(
      '1',
    );
    openDetails('โฆษณาที่ใช้คลิปนี้ (3)');
    await screen.findByRole('link', { name: /วิดีโอหลัก/ });
    const nav = screen.getByRole('navigation', { name: 'หน้าโฆษณาของคลิป' });
    fireEvent.click(within(nav).getByRole('button', { name: 'ถัดไป' }));
    await screen.findByRole('link', { name: /ทดสอบข้อความ/ });
    expect(screen.queryByRole('link', { name: /วิดีโอหลัก/ })).toBeNull();
  });
  it('partner-only detail never fabricates amounts or requests clip earnings', async () => {
    const send = vi.fn(async (r: ContentRequest) => contentFixture(r, 'partial'));
    render(wrap(<ContentDetail {...props} transport={send} />));
    await screen.findByText('ยังจับคู่ไม่ได้');
    expect(screen.queryByText('฿12,800')).toBeNull();
    openDetails('รายได้และวิธีคำนวณ');
    await screen.findByText(/ยังไม่สามารถแสดงรายการฐานยอดขาย/);
    expect(send.mock.calls.map(([r]) => r.resource)).toEqual(['detail']);
  });
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
  it('ad metrics have no repeated clip earnings and hide spend/ROAS without capability', async () => {
    render(wrap(<AdDetail {...props} adId="clip-1-ad-1" />));
    await screen.findByText('81,200');
    expect(screen.queryByText('ค่าโฆษณา')).toBeNull();
    expect(screen.queryByText('ROAS')).toBeNull();
    expect(screen.queryByText('฿12,800')).toBeNull();
    expect(screen.getByText('ผู้ชมไม่ซ้ำ').closest('article')).toHaveTextContent('—');
    expect(screen.getByText('ผลลัพธ์ที่แพลตฟอร์มรายงาน')).toBeVisible();
    const data = await loadContent(transport, request('ad'));
    render(<MetricSections metrics={data.data.metrics} canViewAdSpend />);
    expect(screen.getByText('ค่าโฆษณา')).toBeVisible();
    expect(screen.getByText('ROAS')).toBeVisible();
    expect(screen.getByText('฿9,000.00')).toBeVisible();
  });
  it('all six clips share one page, search preserves context and reset restores all filters', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'รีเซ็ตตัวกรอง' }));
    expect(onChange).toHaveBeenLastCalledWith(context);
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
