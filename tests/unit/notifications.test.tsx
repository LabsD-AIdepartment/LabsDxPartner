import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NotificationCenter } from '@/features/notifications/NotificationCenter';
import { loadNotifications, markNotificationsSeen } from '@/features/notifications/http';
import { createQueryClient } from '@/shared/query/provider';
import { partnerKey } from '@/shared/query/keys';
import { AccessLost } from '@/shared/query/revision-watcher';
vi.mock('@/features/notifications/http', () => ({
  loadNotifications: vi.fn(),
  markNotificationsSeen: vi.fn(),
}));
const scope = { userId: 'user', partnerId: 'partner', permissionRevision: 'p1:m1' };
const page = {
  items: [
    {
      id: '1',
      statementId: 'statement',
      title: 'มีใบสรุปรายได้รอบใหม่',
      kind: 'statement-published' as const,
      createdAt: '2026-09-01T00:00:00Z',
      seen: false,
    },
  ],
  unseenCount: 1,
  totalCount: 1,
  nextCursor: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function () {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function () {
      this.open = false;
    },
  });
  vi.mocked(loadNotifications).mockResolvedValue(structuredClone(page));
});
afterEach(() => vi.restoreAllMocks());
function mount(client = createQueryClient(), onAccessLost = vi.fn()) {
  return {
    ...render(
      <QueryClientProvider client={client}>
        <NotificationCenter scope={scope} onAccessLost={onAccessLost} />
      </QueryClientProvider>,
    ),
    client,
    onAccessLost,
  };
}
describe('native notification presentation', () => {
  it('waits for critical data, then renders real unseen badge and marks/refetches', async () => {
    const client = createQueryClient();
    let release!: (value: string) => void;
    const critical = client.fetchQuery({
      queryKey: partnerKey(scope, 'earnings', 'overview'),
      queryFn: () => new Promise<string>((r) => (release = r)),
    });
    mount(client);
    expect(loadNotifications).not.toHaveBeenCalled();
    release('ready');
    await critical;
    fireEvent.click(
      await screen.findByRole('button', { name: 'การแจ้งเตือน 1 รายการที่ยังไม่อ่าน' }),
    );
    let finish!: () => void;
    vi.mocked(markNotificationsSeen).mockImplementation(
      () => new Promise((r) => (finish = () => r({ ...scope, throughNoticeId: '1' }))),
    );
    fireEvent.click(screen.getByRole('button', { name: 'อ่านแล้ว' }));
    expect(screen.getByRole('button', { name: 'อ่านแล้ว' })).toBeDisabled();
    vi.mocked(loadNotifications).mockResolvedValue({
      ...page,
      unseenCount: 0,
      items: [{ ...page.items[0], seen: true }],
    });
    finish();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'อ่านแล้ว' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'การแจ้งเตือน' })).toBeVisible();
  });
  it('keeps unread state on failed mark and supports retry', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /การแจ้งเตือน 1/ }));
    vi.mocked(markNotificationsSeen).mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'อ่านแล้ว' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('บันทึกสถานะอ่านไม่สำเร็จ');
    expect(screen.getByRole('button', { name: 'อ่านแล้ว' })).toBeEnabled();
  });
  it('clears displayed notices after access loss and aborts an in-flight mark on unmount', async () => {
    const mounted = mount();
    fireEvent.click(await screen.findByRole('button', { name: /การแจ้งเตือน 1/ }));
    let signal: AbortSignal | undefined;
    vi.mocked(markNotificationsSeen).mockImplementation(async (_scope, _id, current) => {
      signal = current;
      return new Promise(() => {});
    });
    fireEvent.click(screen.getByRole('button', { name: 'อ่านแล้ว' }));
    mounted.unmount();
    expect(signal?.aborted).toBe(true);
    vi.mocked(loadNotifications).mockRejectedValue(new AccessLost());
    const second = mount();
    await waitFor(() => expect(second.onAccessLost).toHaveBeenCalled());
    expect(screen.queryByText(page.items[0].title)).not.toBeInTheDocument();
  });
  it('loads older notices and shows an honest fetch error with retry', async () => {
    vi.mocked(loadNotifications)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...page, nextCursor: 'older' })
      .mockResolvedValueOnce({
        ...page,
        items: [{ ...page.items[0], id: '2', title: 'รายการก่อนหน้า' }],
      });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือน' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }));
    fireEvent.click(await screen.findByRole('button', { name: 'ดูรายการก่อนหน้า' }));
    expect(await screen.findByText('รายการก่อนหน้า')).toBeVisible();
  });
});
