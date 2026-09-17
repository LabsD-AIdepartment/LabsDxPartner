import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { previewVideoRead, createPreviewVideoRegistration } from '../../dev/shop-video-transport';
import {
  loadShopVideos,
  loadVideoOptions,
  lookupVideo,
  saveVideo,
  VideoRequestError,
} from '@/features/shop-video/transport';
import { ShopVideoPerformanceView, ShopVideoPanel } from '@/features/shop-video/ShopVideoPanel';
import { ShopVideoRegistration } from '@/features/shop-video/ShopVideoRegistration';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { ReportCountChart } from '@/shared/ui/ReportCountChart';
const q = {
  partnerId: 'p',
  permissionRevision: '1',
  clipId: 'clip-1',
  from: '2026-09-01',
  toExclusive: '2026-09-03',
};
const scope = { actorId: 'staff', permissionRevision: '1' };
const signal = () => new AbortController().signal;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <IsolatedQueryProvider identity={['test']}>{children}</IsolatedQueryProvider>
);
describe('shared video frontend', () => {
  it('rejects wrong partner, permission, clip and date responses', async () => {
    for (const change of [
      { partnerId: 'other' },
      { permissionRevision: '2' },
      { clipId: 'other' },
      { period: { from: q.from, toExclusive: '2026-09-04' } },
    ]) {
      await expect(
        loadShopVideos(
          async () =>
            ({ ...((await previewVideoRead(q, signal())) as object), ...change }) as object,
          q,
          signal(),
        ),
      ).rejects.toThrow();
    }
  });
  it('rejects duplicate mappings and overlapping intervals', async () => {
    const value = await loadShopVideos(previewVideoRead, q, signal());
    await expect(
      loadShopVideos(
        async () => ({ ...value, items: [value.items[0], value.items[0]] }),
        q,
        signal(),
      ),
    ).rejects.toThrow();
    value.items[0].performance.series[1].period.from = q.from;
    await expect(loadShopVideos(async () => value, q, signal())).rejects.toThrow();
  });
  it('does not accept completed stale responses after cancellation', async () => {
    const abort = new AbortController();
    await expect(
      loadShopVideos(
        async () => {
          const v = await previewVideoRead(q, signal());
          abort.abort();
          return v;
        },
        q,
        abort.signal,
      ),
    ).rejects.toThrow();
  });
  it('preserves exact money and commercial counts, hiding audience counts and distinguishing missing from zero', async () => {
    const v = await loadShopVideos(previewVideoRead, q, signal());
    const p = v.items[0].performance;
    p.gmv = { amount: '9007199254740993.01', currency: 'THB' };
    p.views = '7654321';
    p.paidSkuOrders = '0';
    p.itemsSold = null;
    p.state = 'partial';
    render(<ShopVideoPerformanceView performance={p} />);
    expect(screen.getByText('9,007,199,254,740,993.01 THB')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('ยอดดูวิดีโอ')).toBeNull();
    expect(screen.queryByText('7,654,321')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.getByText('ข้อมูลยังไม่ครบช่วงที่เลือก จึงยังไม่รวมยอดทั้งหมด'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
  it('shared chart breaks lines across missing periods', () => {
    const { container } = render(
      <ReportCountChart
        label="ยอดดู"
        period={q}
        series={[
          { period: { from: q.from, toExclusive: '2026-09-02' }, value: '9007199254740993' },
          { period: { from: '2026-09-02', toExclusive: q.toExclusive }, value: null },
        ]}
      />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.innerHTML).not.toContain('NaN');
  });
  it('formats click rates as percentages for totals and source periods without combining them', async () => {
    const v = await loadShopVideos(previewVideoRead, q, signal());
    const p = v.items[0].performance;
    p.productClickThroughRate = '0';
    render(<ShopVideoPerformanceView performance={p} />);
    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.getAllByText('4.50%')).toHaveLength(2);
    expect(screen.queryByText(/สัดส่วน/)).toBeNull();
    expect(screen.queryByText('9.00%')).toBeNull();
  });
  it('does not show a previous clip while a new scope is loading', async () => {
    const transport = vi.fn(previewVideoRead);
    const props = {
      scope: { userId: 'u', partnerId: 'p', permissionRevision: '1' },
      clipId: q.clipId,
      from: q.from,
      toExclusive: q.toExclusive,
      transport,
    };
    const { rerender } = render(<ShopVideoPanel {...props} />, { wrapper });
    await screen.findAllByText('ออเดอร์สินค้า (SKU) ที่ชำระแล้ว');
    transport.mockImplementation(() => new Promise(() => {}));
    rerender(<ShopVideoPanel {...props} clipId="clip-2" />);
    expect(screen.queryAllByText('ออเดอร์สินค้า (SKU) ที่ชำระแล้ว')).toHaveLength(0);
  });
  it('rejects options outside the staff scope', async () => {
    const t = createPreviewVideoRegistration();
    t.options = async () =>
      ({
        ...((await createPreviewVideoRegistration().options(scope, signal())) as object),
        actorId: 'other',
      }) as object;
    await expect(loadVideoOptions(t, scope, signal())).rejects.toThrow();
  });
  it('filters preview targets by a partial name and clears unmatched searches', async () => {
    const t = createPreviewVideoRegistration();
    const matching = await loadVideoOptions(t, { ...scope, q: ' มด ' }, signal());
    expect(matching.q).toBe('มด');
    expect(matching.targets).toHaveLength(1);
    const missing = await loadVideoOptions(t, { ...scope, q: 'ไม่มีคลิปชื่อนี้' }, signal());
    expect(missing.targets).toEqual([]);
    expect(missing.connections).toHaveLength(1);
    const cleared = await loadVideoOptions(t, { ...scope, q: '  ' }, signal());
    expect(cleared.targets).toHaveLength(1);
  });
  it('explains an empty search and restores choices when the search is cleared', async () => {
    const t = createPreviewVideoRegistration();
    render(<ShopVideoRegistration scope={scope} transport={t} />, { wrapper });
    await screen.findByLabelText('Video ID');
    fireEvent.change(screen.getByLabelText('ค้นหาคลิปหรือพาร์ทเนอร์'), {
      target: { value: 'ไม่มีคลิปชื่อนี้' },
    });
    await screen.findByText('ไม่พบคลิปที่ตรงกับคำค้น ลองชื่อคลิปหรือพาร์ทเนอร์อื่น');
    expect(screen.getByRole('button', { name: 'ค้นหาวิดีโอ' })).toBeDisabled();
    expect(screen.queryByRole('option', { name: /มดดำ/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('ค้นหาคลิปหรือพาร์ทเนอร์'), {
      target: { value: '' },
    });
    await screen.findByRole('option', { name: /มดดำ/ });
    expect(screen.queryByText('ไม่พบคลิปที่ตรงกับคำค้น ลองชื่อคลิปหรือพาร์ทเนอร์อื่น')).toBeNull();
  });
  it('recovers from a temporary options failure without calling it an access failure', async () => {
    const t = createPreviewVideoRegistration();
    t.options = vi.fn(t.options).mockRejectedValueOnce(new VideoRequestError(503));
    render(<ShopVideoRegistration scope={scope} transport={t} />, { wrapper });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'โหลดรายการคลิปและร้านค้าไม่สำเร็จ กรุณาลองอีกครั้ง',
    );
    expect(screen.queryByText('ยังไม่เปิดการเชื่อม TikTok หรือสิทธิ์ของคุณเปลี่ยนแล้ว')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    await screen.findByLabelText('Video ID');
    expect(t.options).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])(
    'shows an access-specific message for %s without a retry loop',
    async (status) => {
      const t = createPreviewVideoRegistration();
      t.options = vi.fn().mockRejectedValue(new VideoRequestError(status));
      render(<ShopVideoRegistration scope={scope} transport={t} />, { wrapper });
      await screen.findByText('สิทธิ์เปลี่ยน กรุณายืนยันตัวตนอีกครั้ง');
      expect(screen.queryByRole('button', { name: 'ลองอีกครั้ง' })).toBeNull();
      expect(screen.queryByLabelText('Video ID')).toBeNull();
      expect(t.options).toHaveBeenCalledTimes(1);
    },
  );
  it('explains disabled integration separately from transient failure', async () => {
    const t = createPreviewVideoRegistration();
    t.options = vi.fn().mockRejectedValue(new VideoRequestError(404));
    render(<ShopVideoRegistration scope={scope} transport={t} />, { wrapper });
    await screen.findByText('ยังไม่เปิดการเชื่อม TikTok Shop ติดต่อผู้ดูแลระบบ');
    expect(screen.queryByRole('button', { name: 'ลองอีกครั้ง' })).toBeNull();
  });
  it('stops scheduled options polling after access is denied', async () => {
    vi.useFakeTimers();
    const t = createPreviewVideoRegistration();
    t.options = vi.fn().mockRejectedValue(new VideoRequestError(403));
    const view = render(<ShopVideoRegistration scope={scope} transport={t} />, { wrapper });
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(screen.getByText('สิทธิ์เปลี่ยน กรุณายืนยันตัวตนอีกครั้ง')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(t.options).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });
  it('rejects wrong lookup and save results', async () => {
    const t = createPreviewVideoRegistration();
    const query = {
      ...scope,
      targetId: 'video-target',
      connectionId: 'video-shop',
      videoId: '123',
    };
    const proof = await lookupVideo(t, query, signal());
    t.lookup = async () => ({ ...proof, videoId: '456' });
    await expect(lookupVideo(t, query, signal())).rejects.toThrow();
    const { title, creatorName, ...fields } = proof;
    void title;
    void creatorName;
    await expect(
      saveVideo(
        t,
        { ...fields, idempotencyKey: '11111111-1111-4111-8111-111111111111' },
        { partnerId: 'other', clipId: 'clip-3' },
        signal(),
      ),
    ).rejects.toThrow();
  });
  it('invalidates lookup after editing and preserves idempotency on uncertain save', async () => {
    const t = createPreviewVideoRegistration();
    const save = t.save;
    let first = true;
    t.save = vi.fn(async (command, signal) => {
      if (first) {
        first = false;
        throw new Error('Network failed');
      }
      return save(command, signal);
    });
    render(<ShopVideoRegistration scope={scope} transport={t} />, { wrapper });
    await screen.findByLabelText('Video ID');
    fireEvent.change(screen.getByLabelText('คลิปและข้อตกลง'), {
      target: { value: 'video-target' },
    });
    fireEvent.change(screen.getByLabelText('ร้านค้า TikTok'), { target: { value: 'video-shop' } });
    fireEvent.change(screen.getByLabelText('Video ID'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาวิดีโอ' }));
    await screen.findByRole('button', { name: 'ยืนยันผูกวิดีโอ' });
    fireEvent.change(screen.getByLabelText('Video ID'), { target: { value: '456' } });
    expect(screen.queryByRole('button', { name: 'ยืนยันผูกวิดีโอ' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ค้นหาวิดีโอ' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ยืนยันผูกวิดีโอ' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ยืนยันผูกวิดีโอ' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยันผูกวิดีโอ' }));
    await screen.findByText('ผูกวิดีโอกับคลิปแล้ว สถิติที่มีจะแสดงในหน้าคลิปของพาร์ทเนอร์');
    const calls = vi.mocked(t.save).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].idempotencyKey).toBe(calls[1][0].idempotencyKey);
  });
});
