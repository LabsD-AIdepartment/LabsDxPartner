import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => {
  if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  vi.unstubAllGlobals();
});
beforeEach(() => {
  push.mockClear();
  window.history.replaceState({}, '', '/');
});
describe('normal withdrawal preview notifications', () => {
  it.each(['summary', 'history'] as const)(
    'shows the real shared bell, marks seen and opens an existing period statement on %s without DEV opt-in',
    async (page) => {
      const search = 'scenario=applies-wht&identity=b&view=withdrawals';
      render(
        page === 'summary' ? (
          <WithdrawalPreview search={search} />
        ) : (
          <TransactionsPreview search={search} />
        ),
      );
      expect(screen.queryByRole('button', { name: 'ปิดเครื่องมือทดสอบ' })).not.toBeInTheDocument();
      fireEvent.click(
        await screen.findByRole('button', { name: 'การแจ้งเตือน 1 รายการที่ยังไม่อ่าน' }),
      );
      const dialog = screen.getByRole('dialog', { name: 'การแจ้งเตือน' });
      expect(
        within(dialog).getByRole('button', { name: 'สรุปคอมมิชชันพร้อมตรวจสอบ' }),
      ).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: 'อ่านแล้ว' }));
      expect(screen.getByRole('button', { name: /^การแจ้งเตือน$/ })).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'อ่านแล้ว' })).not.toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'สรุปคอมมิชชันพร้อมตรวจสอบ' }));
      expect(push).toHaveBeenCalledTimes(1);
      const destination = new URL(push.mock.calls[0][0], 'http://localhost');
      expect(destination.pathname).toBe('/transactions-preview/statement-1');
      expect(destination.searchParams.get('view')).not.toBe('withdrawals');
      const back = new URL(destination.searchParams.get('returnTo')!, 'http://localhost');
      expect(back.pathname).toBe('/withdrawal-preview');
      expect(back.searchParams.get('scenario')).toBe('applies-wht');
      expect(back.searchParams.get('identity')).toBe('b');
      expect(destination.searchParams.get('request')).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'การแจ้งเตือน' })).not.toBeInTheDocument();
    },
  );
});
