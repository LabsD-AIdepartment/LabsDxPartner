import { afterEach as restoreBrandFlag } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { AccountSettings } from '@/features/account/AccountSettings';
import {
  browserAccountSettingsStorage,
  createAccountSettingsTransport,
} from '../../dev/account-settings-transport';
import { AccountPreview } from '../../dev/AccountPreview';
import { OperationsPreview } from '../../dev/OperationsPreview';
import { WithdrawalPreview } from '../../dev/WithdrawalPreview';
import { TransactionsPreview } from '../../dev/TransactionsPreview';
import { browserWithdrawalStorage } from '../../dev/withdrawals/browser-storage';
import { getWithdrawalRuntime, releaseWithdrawalRuntime } from '../../dev/withdrawals/transport';
import { previewScopeFor } from '../../dev/withdrawals/navigation';
import { SCENARIO_NAMES } from '../../dev/withdrawals/scenarios';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
  for (const scenario of SCENARIO_NAMES)
    for (const identity of ['a', 'b'])
      releaseWithdrawalRuntime(browserWithdrawalStorage, previewScopeFor(scenario, identity));
  window.history.replaceState({}, '', '/?devtools=1');
});
function runtime(scenario = 'golden', identity = 'a') {
  return getWithdrawalRuntime({
    scope: previewScopeFor(scenario, identity),
    storage: browserWithdrawalStorage,
    latencyMs: 0,
  });
}
async function press(name: string) {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}
async function edit(name = 'บัญชีตัวอย่างที่แก้ไข') {
  await press('ดู/แก้ไขบัญชีรับเงิน');
  fireEvent.change(screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('ธนาคารตัวอย่าง'), { target: { value: 'bank-scb' } });
  fireEvent.change(screen.getByLabelText('บัญชีตัวอย่างที่ปิดบังเลขแล้ว'), {
    target: { value: 'acct-1' },
  });
}
function readCard() {
  return within(screen.getByRole('article', { name: 'บัญชีรับเงินปัจจุบัน' }));
}

describe('same-runtime beneficiary account/staff composition', () => {
  it('payout SSR avoids storage; account management uses its scoped identity and existing password journey', async () => {
    const read = vi.spyOn(browserWithdrawalStorage, 'getItem');
    expect(renderToString(<AccountPreview search="view=payout" />)).not.toContain(
      'Account journey preview',
    );
    expect(read).not.toHaveBeenCalled();
    render(<AccountPreview />);
    expect(await screen.findByText('ชื่อผู้ใช้: partner.a')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'จัดการรหัสผ่าน' })).toHaveAttribute(
      'href',
      '/access-preview',
    );
    expect(screen.queryByRole('article', { name: 'บัญชีรับเงินปัจจุบัน' })).not.toBeInTheDocument();
  });
  it('account save becomes pending, staff shares it and DEV verifies it without changing old request recipient', async () => {
    const a = runtime();
    const quote = a.controller.quote('500000');
    if (quote.state !== 'quoted') throw new Error('quote');
    const submitted = a.controller.submit({
      scope: quote.scope,
      idempotencyKey: 'original-recipient',
      quoteId: quote.quoteId,
      gross: quote.gross,
      net: quote.net,
      bindings: quote.bindings,
    });
    if (submitted.outcome === 'rejected') throw new Error('submit');
    const frozen = submitted.request.beneficiary;
    const view = render(<AccountPreview search="view=payout&scenario=golden&identity=a" />);
    expect(await screen.findByRole('button', { name: 'จำลองยืนยันบัญชี' })).toBeDisabled();
    await edit();
    await press('บันทึกบัญชีตัวอย่าง');
    expect(await screen.findByText('รอตรวจสอบบัญชีรับเงินใน DEMO')).toBeInTheDocument();
    expect(a.controller.summary().beneficiary.state).toBe('pending');
    view.rerender(
      <OperationsPreview
        view="requests"
        search={`scenario=golden&identity=a&request=${submitted.request.requestRef}`}
      />,
    );
    expect(await screen.findByText('Staff withdrawal preview')).toBeInTheDocument();
    await waitFor(() => expect(readCard().getByText('บัญชีตัวอย่างที่แก้ไข')).toBeInTheDocument());
    const detail = within(screen.getByRole('article', { name: 'รายละเอียดคำขอถอน' }));
    expect(detail.getByText(frozen.displayName)).toBeInTheDocument();
    expect(detail.queryByText('บัญชีตัวอย่างที่แก้ไข')).not.toBeInTheDocument();
    await press('จำลองยืนยันบัญชี');
    await waitFor(() =>
      expect(screen.queryByText('รอตรวจสอบบัญชีรับเงินใน DEMO')).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('ยืนยันบัญชีรับเงินแล้วใน DEMO')).not.toBeInTheDocument();
    expect(a.controller.summary().beneficiary.state).toBe('known');
    expect(a.controller.detail(submitted.request.requestRef)).toMatchObject({
      state: 'found',
      detail: { request: { beneficiary: frozen } },
    });
    view.rerender(<AccountPreview search="view=payout&scenario=golden&identity=a" />);
    await press('ดู/แก้ไขบัญชีรับเงิน');
    expect(screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง')).toHaveValue('บัญชีตัวอย่างที่แก้ไข');
  });
  it('unknown mode commits current pending data but never claims success or resends while checking', async () => {
    const a = runtime('missing-beneficiary');
    const write = vi.spyOn(a.transport, 'setBeneficiary');
    render(<AccountPreview search="view=payout&scenario=missing-beneficiary&identity=a" />);
    await screen.findByText('ยังไม่ได้ตั้งค่าบัญชีรับเงิน');
    fireEvent.change(screen.getByLabelText('ผลบันทึกบัญชีตัวอย่าง'), {
      target: { value: 'unknown' },
    });
    await edit('unknown saved name');
    await press('บันทึกบัญชีตัวอย่าง');
    await screen.findByRole('button', { name: 'ตรวจสอบข้อมูลปัจจุบัน' });
    expect(
      readCard().queryByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' }),
    ).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);
    await press('ตรวจสอบข้อมูลปัจจุบัน');
    expect(
      await screen.findByText(/ข้อมูลที่แสดงไม่ใช่การยืนยันผลการบันทึกครั้งก่อน/),
    ).toBeInTheDocument();
    expect(readCard().getByText('unknown saved name')).toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText('บันทึกบัญชีรับเงินตัวอย่างแล้ว โปรดดูสถานะปัจจุบัน'),
    ).not.toBeInTheDocument();
  });
  it('real money notifications preserve draft focus, while scope switch clears A draft before B renders', async () => {
    const a = runtime();
    runtime('golden', 'b');
    render(<AccountPreview search="view=payout&scenario=golden&identity=a" />);
    await edit('private draft A');
    const input = screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง');
    input.focus();
    act(() => a.controller.releaseNextPeriod());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'บันทึกบัญชีตัวอย่าง' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง')).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('private draft A');
    fireEvent.change(screen.getByLabelText('พาร์ตเนอร์ตัวอย่าง'), { target: { value: 'b' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await press('ดู/แก้ไขบัญชีรับเงิน');
    expect(screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง')).not.toHaveValue('private draft A');
  });
  it('retains scenario, identity and report return in partner entry links without changing legacy statements', async () => {
    // This regression intentionally exercises the retained opt-in brand return context.
    vi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true');
    runtime('golden', 'b');
    const view = render(<WithdrawalPreview search="scenario=golden&identity=b&brand=Axtion" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'เมนูโปรไฟล์' })[0]);
    const accountLinks = await screen.findAllByRole('link', { name: 'จัดการบัญชี' });
    const href = accountLinks[0].getAttribute('href')!;
    const params = new URL(href, 'http://localhost').searchParams;
    expect(params.get('view')).toBeNull();
    expect(params.get('identity')).toBe('b');
    expect(params.get('scenario')).toBe('golden');
    expect(params.get('returnTo')).toContain('brand=Axtion');
    view.rerender(<TransactionsPreview search="view=withdrawals&scenario=golden&identity=b" />);
    fireEvent.click(screen.getAllByRole('button', { name: 'เมนูโปรไฟล์' })[0]);
    const walletAccount = new URL(
      screen.getAllByRole('link', { name: 'จัดการบัญชี' })[0].getAttribute('href')!,
      'http://localhost',
    );
    expect(walletAccount.searchParams.get('view')).toBeNull();
    expect(walletAccount.searchParams.get('identity')).toBe('b');
    view.rerender(<TransactionsPreview />);
    fireEvent.click(screen.getAllByRole('button', { name: 'เมนูโปรไฟล์' })[0]);
    expect(screen.getAllByRole('link', { name: 'จัดการบัญชี' })[0]).toHaveAttribute(
      'href',
      '/account-preview',
    );
  });
});

restoreBrandFlag(() => vi.unstubAllEnvs());

it('retains scoped notification preferences when moving from settings to Overview and Wallet', async () => {
  const authority = previewScopeFor('golden', 'b');
  const scope = {
    userId: authority.userId,
    partnerId: authority.partnerId,
    permissionRevision: authority.permissionRevision,
  };
  const transport = createAccountSettingsTransport({
    scope,
    storage: browserAccountSettingsStorage,
    initial: { displayName: 'B', currentUsername: 'partner.b' },
    latencyMs: 0,
  });
  const settings = render(<AccountSettings scope={scope} transport={transport} />);
  const releases = await screen.findByLabelText('ตัดรอบคอมมิชชันพร้อมถอน');
  if ((releases as HTMLInputElement).checked) fireEvent.click(releases);
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
  await screen.findByText('บันทึกข้อมูลติดต่อและการแจ้งเตือนแล้ว');
  settings.unmount();
  const view = render(<WithdrawalPreview search="scenario=golden&identity=b" />);
  fireEvent.click(screen.getByRole('button', { name: /การแจ้งเตือน/ }));
  await within(screen.getByRole('dialog', { name: 'การแจ้งเตือน' })).findByText(
    'ยังไม่มีข้อมูลในช่วงเวลานี้',
  );
  expect(screen.queryByText('สรุปคอมมิชชันพร้อมตรวจสอบ')).not.toBeInTheDocument();
  view.rerender(<TransactionsPreview search="view=withdrawals&scenario=golden&identity=b" />);
  fireEvent.click(screen.getByRole('button', { name: /การแจ้งเตือน/ }));
  await within(screen.getByRole('dialog', { name: 'การแจ้งเตือน' })).findByText(
    'ยังไม่มีข้อมูลในช่วงเวลานี้',
  );
  view.rerender(<WithdrawalPreview search="scenario=golden&identity=a" />);
  fireEvent.click(screen.getByRole('button', { name: /การแจ้งเตือน/ }));
  expect(
    await within(screen.getByRole('dialog', { name: 'การแจ้งเตือน' })).findByText(
      'สรุปคอมมิชชันพร้อมตรวจสอบ',
    ),
  ).toBeVisible();
});

it.each(['', 'payout'])(
  'keeps report dates when account view %s navigates back to content and clears detail pagination',
  async (view) => {
    const returnTo =
      '/withdrawal-preview?scenario=golden&identity=b&from=2026-07-01&toExclusive=2026-09-01&origin=overview&generation=older-detail&cursor=old-page';
    const search = new URLSearchParams({ scenario: 'golden', identity: 'b', returnTo });
    if (view) search.set('view', view);
    render(<AccountPreview search={search.toString()} />);
    const links = await screen.findAllByRole('link', { name: 'My content' });
    const destination = new URL(links[0].getAttribute('href')!, 'http://localhost');
    expect(destination.searchParams.get('from')).toBe('2026-07-01');
    expect(destination.searchParams.get('toExclusive')).toBe('2026-09-01');
    expect(destination.searchParams.get('origin')).toBe('content');
    expect(destination.searchParams.has('generation')).toBe(false);
    expect(destination.searchParams.has('cursor')).toBe(false);
  },
);
