import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/features/shell/AppShell';
import { ProfileMenu } from '@/features/shell/ProfileMenu';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { FilterBar, type FilterValue } from '@/shared/ui/FilterBar';
import { Dialog } from '@/shared/ui/Dialog';

let mobile = true;
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
const listeners = new Set<() => void>();
const media = {
  get matches() {
    return mobile;
  },
  addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
};
function resize(next: boolean) {
  act(() => {
    mobile = next;
    listeners.forEach((listener) => listener());
    window.dispatchEvent(new Event('resize'));
  });
}
beforeEach(() => {
  mobile = true;
  exportReport.mockClear();
  seen.mockClear();
  logout.mockClear();
  listeners.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'false');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
      this.querySelector<HTMLButtonElement>('button')?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
const initial: FilterValue = { from: '2026-07-01', toExclusive: '2026-09-01', brand: null };
const exportReport = vi.fn();
const seen = vi.fn();
const logout = vi.fn();
function Page({
  filters = true,
  notices = true,
  count = 1,
}: {
  filters?: boolean;
  notices?: boolean;
  count?: number;
}) {
  const [value, setValue] = useState(initial);
  const [exportOpen, setExportOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  return (
    <AppShell
      active="overview"
      title="Your content"
      accent="Your impact"
      accountMenu={
        <ProfileMenu onLogout={logout}>
          <select aria-label="เลือกพาร์ทเนอร์">
            <option>Partner A</option>
          </select>
        </ProfileMenu>
      }
      notifications={
        notices ? (
          <NotificationButton
            data={{
              unseenCount: count,
              totalCount: count,
              nextCursor: null,
              items: [
                {
                  id: 'notice',
                  statementId: 'statement',
                  title: 'รอบจ่ายใหม่',
                  kind: 'statement-published',
                  createdAt: '2026-09-01T00:00:00Z',
                  seen: false,
                },
              ],
            }}
            onSeen={seen}
            onOpenStatement={vi.fn()}
          />
        ) : null
      }
    >
      {filters && (
        <FilterBar
          value={value}
          brands={[]}
          onChange={setValue}
          onExport={() => {
            exportReport(value);
            setExportOpen(true);
          }}
        />
      )}
      <button onClick={() => setOtherOpen(true)}>Unrelated dialog</button>
      <Dialog open={otherOpen} onClose={() => setOtherOpen(false)} title="Other">
        Other content
      </Dialog>
      <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Export">
        Current report
      </Dialog>
    </AppShell>
  );
}
function openProfile() {
  const trigger = screen.getByRole('button', { name: 'เมนูโปรไฟล์' });
  fireEvent.click(trigger);
  return trigger;
}
describe('mobile shell action placement', () => {
  it('moves calendar before theme and profile, and preserves custom profile children/logout', () => {
    render(
      <StrictMode>
        <Page count={123} />
      </StrictMode>,
    );
    const header = screen.getByRole('banner');
    const controls = within(
      within(header).getByRole('button', { name: 'เปลี่ยนเป็นโหมด Dark' }).parentElement!,
    ).getAllByRole('button');
    expect(controls.map((button) => button.getAttribute('aria-label'))).toEqual([
      'เลือกช่วงวันที่',
      'เปลี่ยนเป็นโหมด Dark',
      'เมนูโปรไฟล์',
    ]);
    expect(screen.queryByRole('button', { name: 'Export report' })).toBeNull();
    const profile = openProfile();
    expect(profile).toHaveAccessibleDescription('123 รายการที่ยังไม่อ่าน');
    expect(within(profile).getByText('99+')).toBeVisible();
    const menu = screen.getByRole('region', { name: 'โปรไฟล์' });
    expect(within(menu).getByRole('button', { name: 'Export report' })).toBeVisible();
    expect(
      within(menu).getByRole('button', { name: 'การแจ้งเตือน 123 รายการที่ยังไม่อ่าน' }),
    ).toBeVisible();
    expect(within(menu).getByRole('combobox', { name: 'เลือกพาร์ทเนอร์' })).toBeVisible();
    fireEvent.click(within(menu).getByRole('button', { name: 'ออกจากระบบ' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('opens notifications without unmounting its dialog or marking data seen and returns focus to profile', () => {
    render(<Page />);
    const profile = openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'การแจ้งเตือน 1 รายการที่ยังไม่อ่าน' }));
    const dialog = screen.getByRole('dialog', { name: 'การแจ้งเตือน' });
    expect(dialog).toBeVisible();
    expect(profile).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'โปรไฟล์' })).toBeNull();
    expect(seen).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'อ่านแล้ว' }));
    expect(seen).toHaveBeenCalledWith('notice');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(profile).toHaveFocus();
  });

  it('keeps calendar drafts across breakpoint moves and exports the latest applied range from profile', () => {
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'เลือกช่วงวันที่' }));
    fireEvent.click(screen.getByRole('button', { name: '2026-07-05' }));
    resize(false);
    expect(screen.getByRole('dialog', { name: 'เลือกช่วงวันที่' })).toBeVisible();
    expect(screen.getByRole('button', { name: /^เริ่มวันที่/ })).toHaveTextContent('05/07/2026');
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    const desktopCalendar = screen.getByRole('button', { name: 'เลือกช่วงวันที่' });
    expect(desktopCalendar).toHaveFocus();
    expect(screen.getByRole('main')).toContainElement(desktopCalendar);
    resize(true);
    const profile = openProfile();
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    expect(exportReport).toHaveBeenLastCalledWith({ ...initial, from: '2026-07-05' });
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeVisible();
    expect(profile).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Export' })).getByRole('button', {
        name: 'ปิดหน้าต่าง',
      }),
    );
    expect(profile).toHaveFocus();
  });

  it.each([
    ['export', false],
    ['notification', false],
    ['export', true],
    ['notification', true],
  ] as const)(
    'restores a visible profile target when a desktop %s trigger relocates (roundtrip=%s)',
    (kind, roundtrip) => {
      mobile = false;
      render(<Page />);
      const trigger = screen.getByRole('button', {
        name: kind === 'export' ? 'Export report' : 'การแจ้งเตือน 1 รายการที่ยังไม่อ่าน',
      });
      trigger.focus();
      fireEvent.click(trigger);
      resize(true);
      if (roundtrip) resize(false);
      expect(trigger.isConnected).toBe(false);
      const dialog = screen.getByRole('dialog', {
        name: kind === 'export' ? 'Export' : 'การแจ้งเตือน',
      });
      expect(dialog).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: 'ปิดหน้าต่าง' }));
      expect(screen.getByRole('button', { name: 'เมนูโปรไฟล์' })).toHaveFocus();
    },
  );

  it('does not redirect unrelated dialog focus and removes obsolete report/notification controls on navigation', () => {
    const view = render(<Page />);
    const trigger = screen.getByRole('button', { name: 'Unrelated dialog' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Other' })).getByRole('button', {
        name: 'ปิดหน้าต่าง',
      }),
    );
    expect(trigger).toHaveFocus();
    view.rerender(<Page filters={false} notices={false} />);
    expect(screen.queryByRole('button', { name: 'เลือกช่วงวันที่' })).toBeNull();
    const profile = openProfile();
    expect(profile).not.toHaveAccessibleDescription();
    expect(screen.queryByRole('button', { name: 'Export report' })).toBeNull();
    expect(screen.queryByRole('button', { name: /การแจ้งเตือน/ })).toBeNull();
  });

  it('retains inline controls when used outside a shell and keeps desktop controls outside profile', () => {
    const standalone = render(
      <FilterBar value={initial} brands={[]} onChange={vi.fn()} onExport={exportReport} />,
    );
    expect(screen.getByRole('button', { name: 'เลือกช่วงวันที่' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export report' })).toBeVisible();
    standalone.unmount();
    mobile = false;
    render(<Page />);
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('button', { name: 'Export report' }),
    );
    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('button', { name: /การแจ้งเตือน/ }),
    );
    openProfile();
    expect(
      within(screen.getByRole('region', { name: 'โปรไฟล์' })).queryByRole('button', {
        name: 'Export report',
      }),
    ).toBeNull();
  });
});
