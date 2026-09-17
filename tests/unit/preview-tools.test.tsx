import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { previewScopeFor } from '../../dev/withdrawals/navigation';
import { releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { PreviewTools } from '../../dev/PreviewTools';
import { AccountPreview } from '../../dev/AccountPreview';
import { AccessPreview } from '../../dev/AccessPreview';
import { OverviewPreview } from '../../dev/OverviewPreview';
import { ContentPreview } from '../../dev/ContentPreview';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { OperationsPreview } from '../../dev/OperationsPreview';
import { AdRegistrationPreview } from '../../dev/AdRegistrationPreview';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
beforeAll(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  window.history.replaceState({}, '', '/account-preview');
  for (const identity of ['a', 'b'])
    releaseWithdrawalRuntime(browserWithdrawalStorage, previewScopeFor('golden', identity));
});

describe('explicit page-local preview tools', () => {
  it.each(['withdrawal', 'transactions', 'staff', 'payout'] as const)(
    'keeps real persistence failure visible with tools closed on %s',
    async (page) => {
      vi.spyOn(browserWithdrawalStorage, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });
      const pages = {
        withdrawal: <WithdrawalPreview />,
        transactions: <TransactionsPreview search="view=withdrawals" />,
        staff: <OperationsPreview view="requests" />,
        payout: <AccountPreview search="view=payout" />,
      };
      render(pages[page]);
      expect(await screen.findByText(/อ่านสถานะตัวอย่างจาก storage ไม่ได้ชั่วคราว/)).toBeVisible();
      expect(screen.queryByRole('button', { name: 'ปิดเครื่องมือทดสอบ' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'เริ่มข้อมูลจำลองขอบเขตนี้ใหม่' }),
      ).not.toBeInTheDocument();
    },
  );

  it('does not mount diagnostics by default on client or SSR, even with an opted-in browser URL during SSR', () => {
    const mounted = vi.fn();
    function Diagnostic() {
      useEffect(mounted, []);
      return <button>debug action</button>;
    }
    render(
      <PreviewTools toolbar>
        <Diagnostic />
      </PreviewTools>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(mounted).not.toHaveBeenCalled();
    window.history.replaceState({}, '', '/account-preview?devtools=1');
    expect(
      renderToString(
        <PreviewTools toolbar>
          <Diagnostic />
        </PreviewTools>,
      ),
    ).not.toContain('debug action');
  });
  it('only accepts exact devtools=1 and responds to browser back/forward', () => {
    render(
      <PreviewTools>
        <button>debug action</button>
      </PreviewTools>,
    );
    act(() => {
      window.history.replaceState({}, '', '?devtools=true');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByText('debug action')).not.toBeInTheDocument();
    act(() => {
      window.history.replaceState({}, '', '?devtools=1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.getByText('debug action')).toBeInTheDocument();
    act(() => {
      window.history.replaceState({}, '', '/overview-preview');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByText('debug action')).not.toBeInTheDocument();
  });
  it('close unmounts every gate, removes only the flag and preserves history state, data storage and normal controls', () => {
    window.history.replaceState(
      { retained: 'next-state' },
      '',
      '/account-preview?view=payout&identity=b&devtools=1#current',
    );
    const stored = vi.spyOn(Storage.prototype, 'setItem');
    const removed = vi.spyOn(Storage.prototype, 'removeItem');
    const unmount = vi.fn();
    function Diagnostic() {
      useEffect(() => unmount, []);
      return <button>debug action</button>;
    }
    const tree = (
      <>
        <PreviewTools toolbar>
          <Diagnostic />
        </PreviewTools>
        <PreviewTools>
          <a href="/ops-preview">cross-role</a>
        </PreviewTools>
        <button>normal action</button>
      </>
    );
    const view = render(tree);
    expect(screen.getByText('debug action')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ปิดเครื่องมือทดสอบ' }));
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('cross-role')).not.toBeInTheDocument();
    expect(screen.getByText('normal action')).toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/account-preview?view=payout&identity=b#current',
    );
    expect(window.history.state).toEqual({ retained: 'next-state' });
    expect(stored).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    view.unmount();
    render(tree);
    expect(screen.queryByText('debug action')).not.toBeInTheDocument();
  });
  it('all preview SSR callers omit diagnostic chrome and cross-role test links', () => {
    const pages = [
      <AccessPreview key="access" />,
      <AccountPreview key="account" />,
      <AccountPreview key="payout" search="view=payout" />,
      <OverviewPreview key="overview" />,
      <ContentPreview key="content" />,
      <TransactionsPreview key="transactions" />,
      <TransactionsPreview key="history" search="view=withdrawals" />,
      <OperationsPreview key="operations" />,
      <OperationsPreview key="staff" view="requests" />,
      <AdRegistrationPreview key="ads" />,
      <WithdrawalPreview key="withdrawals" />,
    ];
    for (const page of pages) {
      const html = renderToString(page);
      expect(html).not.toMatch(
        /journey preview|Celebrity mock journey|Marketing ads preview|Staff withdrawal preview|Withdrawal preview|ปิดเครื่องมือทดสอบ|ชุดตรวจ|>เจ้าหน้าที่จำลอง<|ความพร้อมในหน้าเจ้าหน้าที่|ทดลองตั้งบัญชีและเปลี่ยนรหัสผ่านของคุณ/,
      );
    }
  });
  it('normal account retains account features while its diagnostic journey CTA is absent', async () => {
    render(<AccountPreview />);
    expect(await screen.findByText('ชื่อผู้ใช้: partner.a')).toBeInTheDocument();
    expect(screen.queryByText('Account journey preview')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'ทดลองตั้งบัญชีและเปลี่ยนรหัสผ่านของคุณ' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('ข้อตกลงของคุณ')).toBeInTheDocument();
  });
  it('default withdrawal summary keeps primary Transactions navigation and notifications without redundant demo navigation', async () => {
    render(<WithdrawalPreview />);
    expect(await screen.findByRole('article', { name: 'สรุปยอดพร้อมถอน' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Wallet' })[0]).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'หน้าการถอนเงิน' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'ชุดตรวจการถอนเงินจำลอง' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^การแจ้งเตือน/ })).toBeInTheDocument();
  });
});
