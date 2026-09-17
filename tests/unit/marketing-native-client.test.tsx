import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createNativeAdTransport } from '@/features/marketing-ads/http';
import { TargetSetup } from '@/features/marketing-ads/TargetSetup';
import { ShopVideoRegistration } from '@/features/shop-video/ShopVideoRegistration';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { safeReturnTo } from '@/shared/routing/partner-paths';
const scope = { actorId: 'staff', permissionRevision: '1' };
const draft = {
  targetId: 'target',
  connectionId: 'connection',
  platform: 'facebook' as const,
  externalId: '900719925474099312345',
};
const receipt = {
  schemaVersion: 2,
  receipt: 'b9edecb3-589b-4dd8-90f2-44a1b6ba01d8',
  expiresAt: '2099-01-01T00:00:00Z',
  draft,
  source: {
    schemaVersion: 2,
    identity: {
      schemaVersion: 2,
      platform: 'facebook',
      capability: 'facebook.ad_insights',
      namespace: 'meta',
      connectionId: 'connection',
      accountId: '123',
      objectType: 'ad',
      externalId: draft.externalId,
    },
    apiVersion: 'test',
    sourceRevision: null,
    name: 'Test ad',
    creativeIds: ['creative'],
    fetchedAt: '2026-09-01T00:00:00Z',
  },
};
describe('native marketing client', () => {
  it('adapts V2 source without numeric coercion and retries the same command after ambiguous failure', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(receipt))
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(Response.json({ code: 'FRESH_AUTH_REQUIRED' }, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const t = createNativeAdTransport(),
      signal = new AbortController().signal;
    const resolved = await t.resolve({ scope, draft, signal });
    expect(resolved).toMatchObject({ draft, creativeId: 'creative', accountId: '123' });
    const command = { scope, draft, receipt: receipt.receipt, signal };
    await expect(t.save(command)).rejects.toThrow('connection lost');
    await expect(t.save(command)).rejects.toThrow('ยืนยันตัวตน');
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).draft.externalId).toBe(draft.externalId);
    vi.unstubAllGlobals();
  });
  it('uses catalogue choices and submits a deal reference, with no amount/rate fields', async () => {
    let created = false;
    const videoTransport = {
      options: vi.fn(async () => ({
        ...scope,
        q: '',
        hasMore: false,
        connections: [{ id: 'shop', label: 'ร้านทดสอบ', available: true }],
        targets: created
          ? [
              {
                id: 'target',
                partnerId: 'partner',
                clipId: 'clip',
                label: 'คุณ · คลิปตัวอย่าง · ดีลเดือนกันยายน',
              },
            ]
          : [],
      })),
      lookup: vi.fn(),
      save: vi.fn(),
    };
    const fetcher = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      if (options.method === 'POST') {
        created = true;
        return Response.json({ targetId: 'target', replayed: false });
      }
      return Response.json({
        ...scope,
        q: '',
        hasMore: false,
        clips: [
          { partnerId: 'partner', partnerName: 'คุณ', clipId: 'clip', title: 'คลิปตัวอย่าง' },
        ],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <IsolatedQueryProvider identity={['native-target-test']}>
        <TargetSetup scope={scope} />
        <ShopVideoRegistration scope={scope} transport={videoTransport} />
      </IsolatedQueryProvider>,
    );
    await screen.findByText('ยังไม่มีคลิปให้เชื่อม ติดต่อทีม Labs D เพื่อเพิ่มคลิปและข้อตกลง');
    fireEvent.click(screen.getByText('เพิ่มคลิปและดีลสำหรับเชื่อมแอด'));
    fireEvent.change(await screen.findByLabelText('คลิปของพาร์ทเนอร์'), {
      target: { value: JSON.stringify(['partner', 'clip']) },
    });
    fireEvent.change(screen.getByLabelText('รหัสดีลที่ตกลงแล้ว'), { target: { value: 'deal' } });
    fireEvent.change(screen.getByLabelText('ชื่อดีล'), { target: { value: 'ดีลเดือนกันยายน' } });
    fireEvent.change(screen.getByLabelText('เอกสารหรือเลขอ้างอิงข้อตกลง'), {
      target: { value: 'doc-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่มคลิปในดีล' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('เพิ่มคลิปในดีลแล้ว'));
    await screen.findByRole('option', { name: 'คุณ · คลิปตัวอย่าง · ดีลเดือนกันยายน' });
    expect(
      screen.queryByText('ยังไม่มีคลิปให้เชื่อม ติดต่อทีม Labs D เพื่อเพิ่มคลิปและข้อตกลง'),
    ).not.toBeInTheDocument();
    const post = fetcher.mock.calls.find(([, o]) => o.method === 'POST');
    expect(JSON.parse(post![1].body)).toEqual({
      ...scope,
      partnerId: 'partner',
      clipId: 'clip',
      agreementId: 'deal',
      agreementLabel: 'ดีลเดือนกันยายน',
      evidenceRef: 'doc-123',
      idempotencyKey: expect.any(String),
    });
    vi.unstubAllGlobals();
  });
  it('allows the exact staff destination for login recovery', () => {
    expect(safeReturnTo('/ops/ads')).toBe('/ops/ads');
    expect(safeReturnTo('/ops/ads/else')).toBe('/overview');
  });
});
