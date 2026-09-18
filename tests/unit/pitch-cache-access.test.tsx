import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { SessionValue } from '@/contracts/session';
const guards = vi.hoisted(() => ({ clear: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => guards.router }));
vi.mock('@/shared/query/NavigationQueryCache', () => ({
  useClearNavigationQueries: () => guards.clear,
  RetainQuerySession: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../dev/WithdrawalPreview', () => ({ WithdrawalPreview: () => <p>Verified report</p> }));
vi.mock('../../dev/ContentPreview', () => ({ ContentPreview: () => null }));
vi.mock('../../dev/TransactionsPreview', () => ({ TransactionsPreview: () => null }));
vi.mock('../../dev/PayoutAccountPreview', () => ({ PayoutAccountPreview: () => null }));
vi.mock('@/features/partner-application/PartnerApplication', () => ({
  PartnerApplication: () => null,
}));
import { PitchApplication } from '../../dev/PitchApplication';
const session: SessionValue = {
  userId: 'native-user',
  activePartnerId: 'native-partner',
  displayName: 'Partner',
  access: 'active',
  memberships: [
    {
      partnerId: 'native-partner',
      partnerName: 'Partner',
      permissionRevision: '1',
      capabilities: ['view_earnings', 'view_content', 'view_statements', 'view_ad_spend'],
    },
  ],
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('clears retained data and requests fresh server authorization when live revision changes', async () => {
  const changed = {
    ...session,
    memberships: [{ ...session.memberships[0], permissionRevision: '2' }],
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(changed)))
    .mockResolvedValueOnce(new Response(JSON.stringify(changed)));
  vi.stubGlobal('fetch', fetcher);
  const ui = (s: SessionValue) => (
    <PitchApplication session={s} screen={{ kind: 'overview' }} search="" />
  );
  const view = render(ui(session));
  await waitFor(() => expect(guards.router.refresh).toHaveBeenCalledOnce());
  expect(guards.clear).toHaveBeenCalledOnce();
  expect(screen.queryByText('Verified report')).toBeNull();
  view.rerender(ui(changed));
  expect(await screen.findByText('Verified report')).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('clears retained data and hides reports on verification failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  render(<PitchApplication session={session} screen={{ kind: 'overview' }} search="" />);
  expect(await screen.findByText('ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่')).toBeVisible();
  expect(guards.clear).toHaveBeenCalledOnce();
  expect(screen.queryByText('Verified report')).toBeNull();
});

it('ignores an aborted older verification that completes after a newer valid one', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(session)));
  vi.stubGlobal('fetch', fetcher);
  render(<PitchApplication session={session} screen={{ kind: 'overview' }} search="" />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  act(() => window.dispatchEvent(new Event('pageshow')));
  expect(await screen.findByText('Verified report')).toBeVisible();
  await act(async () => finish(new Response(JSON.stringify({ ...session, access: 'suspended' }))));
  expect(guards.clear).not.toHaveBeenCalled();
  expect(guards.router.refresh).not.toHaveBeenCalled();
  expect(screen.getByText('Verified report')).toBeVisible();
});
