import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ConnectionsPanel,
  type ConnectionTransport,
} from '@/features/marketing-ads/ConnectionsPanel';
import { IsolatedQueryProvider } from '@/shared/query/provider';
const scope = { actorId: 'staff', permissionRevision: '1' };
const row = {
  id: 'account',
  label: 'บัญชีตัวอย่าง',
  platform: 'facebook',
  accountId: '123',
  revision: '1',
  enabled: true,
  configured: true,
  verifiedAt: null,
  jobs: 2,
  attention: 1,
  lastSuccessAt: null,
};
function show(transport: ConnectionTransport) {
  const result = render(
    <IsolatedQueryProvider identity={['connections-test']}>
      <ConnectionsPanel scope={scope} transport={transport} />
    </IsolatedQueryProvider>,
  );
  fireEvent.click(screen.getByText('การเชื่อมต่อและสถานะนำเข้า'));
  return result;
}
describe('shared connection controls', () => {
  it('does not offer retry for account access holds', async () => {
    show({
      read: async () => ({ ...scope, connections: [{ ...row, attention: 2, retryable: 0 }] }),
      command: vi.fn(),
    });
    expect(await screen.findByRole('button', { name: 'ตรวจการเชื่อมต่อ' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ลองงานที่ผิดพลาดใหม่' })).toBeNull();
  });
  it('keeps Facebook and TikTok query caches separate and uses report-period labels', async () => {
    render(
      <IsolatedQueryProvider identity={['two-platforms']}>
        <ConnectionsPanel
          scope={scope}
          transport={{ read: async () => ({ ...scope, connections: [row] }), command: vi.fn() }}
        />
        <ConnectionsPanel
          scope={scope}
          platform="tiktok"
          transport={{
            read: async () => ({
              ...scope,
              connections: [{ ...row, id: 'shop', platform: 'tiktok', label: 'ร้านทดสอบ' }],
            }),
            command: vi.fn(),
          }}
        />
      </IsolatedQueryProvider>,
    );
    fireEvent.click(screen.getByText('การเชื่อมต่อและสถานะนำเข้า'));
    fireEvent.click(screen.getByText('ร้าน TikTok Shop และสถานะนำเข้า'));
    expect(await screen.findByText('ร้านทดสอบ')).toBeVisible();
    expect(await screen.findByText(row.label)).toBeVisible();
    expect(screen.getByText(/2 ช่วงรายงาน/)).toBeVisible();
    expect(screen.getByText(/2 แอด/)).toBeVisible();
  });
  it('rejects a response from another platform and keeps Pause available without owner configuration', async () => {
    const r = render(
      <IsolatedQueryProvider identity={['wrong-lane']}>
        <ConnectionsPanel
          scope={scope}
          platform="tiktok"
          transport={{ read: async () => ({ ...scope, connections: [row] }), command: vi.fn() }}
        />
      </IsolatedQueryProvider>,
    );
    fireEvent.click(screen.getByText('ร้าน TikTok Shop และสถานะนำเข้า'));
    expect(await screen.findByText('ข้อมูลการเชื่อมต่อไม่ตรงกับแพลตฟอร์ม')).toBeVisible();
    expect(screen.queryByText(row.label)).toBeNull();
    r.unmount();
    show({
      read: async () => ({ ...scope, connections: [{ ...row, configured: false }] }),
      command: vi.fn(),
    });
    expect(await screen.findByRole('button', { name: 'พักการรับข้อมูล' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'ตรวจการเชื่อมต่อ' })).toBeDisabled();
  });
  it('keeps account actions collapsed until requested and shows the resulting state', async () => {
    let current = { ...row };
    const command = vi.fn(async () => {
      current = { ...current, enabled: false, revision: '2' };
      return { connectionId: row.id, revision: '2', enabled: false, replayed: false };
    });
    const read = vi.fn(async () => ({ ...scope, connections: [current] }));
    render(
      <IsolatedQueryProvider identity={['collapsed']}>
        <ConnectionsPanel scope={scope} transport={{ read, command }} />
      </IsolatedQueryProvider>,
    );
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('การเชื่อมต่อและสถานะนำเข้า'));
    fireEvent.click(await screen.findByRole('button', { name: 'พักการรับข้อมูล' }));
    expect(await screen.findByRole('status')).toHaveTextContent('พักการรับข้อมูลแล้ว');
    expect(await screen.findByRole('button', { name: 'ตรวจสอบและเปิดรับข้อมูล' })).toBeEnabled();
    expect(command).toHaveBeenCalledTimes(1);
  });
  it('keeps the idempotency key when a command response is lost', async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error('ลองอีกครั้ง')).mockResolvedValueOnce({
      connectionId: row.id,
      revision: '1',
      enabled: true,
      replayed: true,
    });
    show({ read: async () => ({ ...scope, connections: [row] }), command });
    fireEvent.click(await screen.findByRole('button', { name: 'ลองงานที่ผิดพลาดใหม่' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ลองอีกครั้ง');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ลองงานที่ผิดพลาดใหม่' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'ลองงานที่ผิดพลาดใหม่' }));
    await screen.findByRole('status');
    expect(command.mock.calls[0][0]).toEqual(command.mock.calls[1][0]);
  });
  it('rejects data for a different actor and aborts work when the panel closes', async () => {
    const r = show({
      read: async () => ({ ...scope, actorId: 'other', connections: [row] }),
      command: vi.fn(),
    });
    await screen.findByText('สิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง');
    expect(screen.queryByText(row.label)).toBeNull();
    r.unmount();
    let pending: AbortSignal | undefined;
    show({
      read: async () => ({ ...scope, connections: [row] }),
      command: async (_c, signal) => {
        pending = signal;
        return new Promise(() => {});
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'พักการรับข้อมูล' }));
    await waitFor(() => expect(pending).toBeDefined());
    fireEvent.click(screen.getByText('การเชื่อมต่อและสถานะนำเข้า'));
    await waitFor(() => expect(pending?.aborted).toBe(true));
  });
});

describe('optional queue activity', () => {
  const activitySnapshot = {
    ...scope,
    platform: 'facebook',
    evaluatedAt: '2026-09-11T00:04:00Z',
    connections: [
      {
        connectionId: row.id,
        revision: row.revision,
        paused: false,
        reports: 1,
        running: 0,
        waiting: 1,
        scheduled: 0,
        attention: 0,
        oldestWaitingAt: '2026-09-11T00:00:00Z',
        nextAttemptAt: null,
      },
    ],
  };
  it('fetches only when the existing panel opens and renders a separate per-account status', async () => {
    const activity = vi.fn(async () => activitySnapshot);
    render(
      <IsolatedQueryProvider identity={['queue-open']}>
        <ConnectionsPanel
          scope={scope}
          transport={{
            read: async () => ({ ...scope, connections: [row] }),
            command: vi.fn(),
            activity,
          }}
        />
      </IsolatedQueryProvider>,
    );
    expect(activity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('การเชื่อมต่อและสถานะนำเข้า'));
    expect(await screen.findByText(/มีงานรอเริ่มเกิน 3 นาที/)).toBeVisible();
    expect(activity).toHaveBeenCalledTimes(1);
    expect(activity).toHaveBeenCalledWith({ ...scope, platform: 'facebook' }, expect.any(AbortSignal));
  });
  it('keeps connection controls usable when an older server has no activity endpoint', async () => {
    show({
      read: async () => ({ ...scope, connections: [row] }),
      command: vi.fn(),
      activity: async () => {
        throw new Error('404');
      },
    });
    expect(await screen.findByText('ยังตรวจสถานะคิวไม่ได้')).toBeVisible();
    expect(screen.getByRole('button', { name: 'พักการรับข้อมูล' })).toBeEnabled();
  });
});
