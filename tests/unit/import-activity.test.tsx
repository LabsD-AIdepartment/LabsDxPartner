import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImportActivity } from '@/features/marketing-ads/ImportActivity';
import { ImportActivitySnapshot } from '@/contracts/import-activity';
const row = {
  connectionId: 'connection',
  revision: '1',
  paused: false,
  reports: 3,
  running: 1,
  waiting: 1,
  scheduled: 1,
  attention: 0,
  oldestWaitingAt: '2026-09-11T00:00:00Z',
  nextAttemptAt: '2026-09-11T01:00:00Z',
};
const data = {
  actorId: 'staff',
  permissionRevision: '1',
  platform: 'facebook' as const,
  evaluatedAt: '2026-09-11T00:04:00Z',
  connections: [row],
};
describe('shared import activity presentation', () => {
  const freshness = {
    imported: 2,
    missing: 1,
    refreshDue: 1,
    oldestSuccessAt: '2026-09-10T00:00:00Z',
    latestSuccessAt: '2026-09-11T00:03:00Z',
    oldestRefreshDueAt: '2026-09-10T01:00:00Z',
  };
  it('discloses partial coverage and retained overdue reports without claiming completeness', () => {
    render(
      <ImportActivity
        snapshot={{ ...data, connections: [{ ...row, freshness }] }}
        connectionId="connection"
        revision="1"
        unavailable={false}
      />,
    );
    expect(
      screen.getByText(/มีรายงานตามการเชื่อมต่อปัจจุบัน 2\/3 ช่วง · รอนำเข้า 1 ช่วง/),
    ).toBeVisible();
    expect(screen.getByText(/ถึงรอบอัปเดตแล้ว 1 ช่วง/)).toBeVisible();
    expect(screen.getByText(/รายงานเดิมยังดูได้/)).toBeVisible();
  });
  it('accepts old payloads but does not fabricate report coverage', () => {
    expect(ImportActivitySnapshot.safeParse(data).success).toBe(true);
    render(
      <ImportActivity snapshot={data} connectionId="connection" revision="1" unavailable={false} />,
    );
    expect(screen.getByText('ยังตรวจความครบของรายงานไม่ได้')).toBeVisible();
  });
  it('rejects inconsistent coverage counts or missing supporting timestamps', () => {
    const check = (patch: Partial<typeof freshness>) =>
      ImportActivitySnapshot.safeParse({
        ...data,
        connections: [{ ...row, freshness: { ...freshness, ...patch } }],
      }).success;
    expect(check({})).toBe(true);
    expect(check({ missing: 2 })).toBe(false);
    expect(check({ refreshDue: 3 })).toBe(false);
    expect(check({ oldestRefreshDueAt: null as unknown as string })).toBe(false);
  });
  it('shows overdue waiting independently of latest success using the server clock', () => {
    render(
      <ImportActivity snapshot={data} connectionId="connection" revision="1" unavailable={false} />,
    );
    expect(screen.getByText(/กำลังดึง 1 · รอเริ่ม 1/)).toBeVisible();
    expect(screen.getByText(/เกิน 3 นาที/)).toBeVisible();
  });
  it('does not show a stale healthy snapshot after failed refresh or revision mismatch', () => {
    const r = render(
      <ImportActivity snapshot={data} connectionId="connection" revision="1" unavailable />,
    );
    expect(screen.getByText('ยังตรวจสถานะคิวไม่ได้')).toBeVisible();
    r.rerender(
      <ImportActivity snapshot={data} connectionId="connection" revision="2" unavailable={false} />,
    );
    expect(screen.getByText('ยังตรวจสถานะคิวไม่ได้')).toBeVisible();
    expect(screen.queryByLabelText('สถานะคิวนำเข้า')).toBeNull();
  });
  it('does not warn when intentionally paused or waiting for the next eligible attempt', () => {
    const r = render(
      <ImportActivity
        snapshot={{ ...data, connections: [{ ...row, paused: true }] }}
        connectionId="connection"
        revision="1"
        unavailable={false}
      />,
    );
    expect(screen.getByText(/คิวพักอยู่/)).toBeVisible();
    expect(screen.queryByText(/เกิน 3 นาที/)).toBeNull();
    r.rerender(
      <ImportActivity
        snapshot={{
          ...data,
          connections: [{ ...row, waiting: 0, scheduled: 2, oldestWaitingAt: null }],
        }}
        connectionId="connection"
        revision="1"
        unavailable={false}
      />,
    );
    expect(screen.queryByText(/เกิน 3 นาที/)).toBeNull();
    expect(screen.getByText(/รอรอบถัดไป 2/)).toBeVisible();
  });
});
