import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PayoutBeneficiaryExperience,
  type PayoutBeneficiaryExperienceProps,
} from '@/features/withdrawals/PayoutBeneficiaryExperience';
import type { WithdrawalBeneficiaryTransport } from '@/features/withdrawals/model';
import type { SetPayoutBeneficiaryCommandValue } from '@/contracts/withdrawal-journey';
import { createWithdrawalScenario } from '../../dev/withdrawals/transport';
import { previewScopeFor } from '../../dev/withdrawals/navigation';
import { memoryStorage } from '../../dev/withdrawals/store';
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
});
afterAll(() => {
  if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});
function setup() {
  const scope = previewScopeFor('golden', 'a');
  return { scope, ...createWithdrawalScenario({ scope, storage: memoryStorage(), latencyMs: 0 }) };
}
function mount(props: PayoutBeneficiaryExperienceProps) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const tree = (next: PayoutBeneficiaryExperienceProps) => (
    <QueryClientProvider client={client}>
      <PayoutBeneficiaryExperience {...next} />
    </QueryClientProvider>
  );
  const view = render(tree(props));
  return { ...view, update: (next: PayoutBeneficiaryExperienceProps) => view.rerender(tree(next)) };
}
async function edit(name = 'ผู้รับเงินทดสอบ') {
  fireEvent.click(await screen.findByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' }));
  fireEvent.change(screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('ธนาคารตัวอย่าง'), { target: { value: 'bank-scb' } });
  fireEvent.change(screen.getByLabelText('บัญชีตัวอย่างที่ปิดบังเลขแล้ว'), {
    target: { value: 'acct-1' },
  });
}
const saveButton = () => screen.getByRole('button', { name: 'บันทึกบัญชีตัวอย่าง' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('shared beneficiary read/save experience', () => {
  it('saves once for native batched duplicate submit, uses a single captured command and preserves it after close', async () => {
    const a = setup();
    const pending = deferred<unknown>();
    let signal!: AbortSignal;
    const commandSpy = vi.fn(
      ({
        command,
        signal: current,
      }: Parameters<WithdrawalBeneficiaryTransport['setBeneficiary']>[0]) => {
        signal = current;
        return pending.promise;
      },
    );
    mount({ ...a, transport: { ...a.transport, setBeneficiary: commandSpy } });
    await edit();
    const button = saveButton();
    act(() => {
      button.click();
      button.click();
    });
    expect(commandSpy).toHaveBeenCalledTimes(1);
    const command = commandSpy.mock.calls[0][0].command;
    expect(command).toMatchObject({
      scope: a.scope,
      displayName: 'ผู้รับเงินทดสอบ',
      bankId: 'bank-scb',
      accountChoiceId: 'acct-1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'ปิดหน้าต่าง' }));
    expect(signal.aborted).toBe(false);
    await act(async () => pending.resolve(a.controller.setBeneficiary(command)));
    expect(await screen.findByText('รอตรวจสอบบัญชีรับเงินใน DEMO')).toBeInTheDocument();
    expect(commandSpy).toHaveBeenCalledTimes(1);
  });
  it('rejects whitespace-only names without dispatching', async () => {
    const a = setup();
    const write = vi.fn(a.transport.setBeneficiary);
    mount({ ...a, transport: { ...a.transport, setBeneficiary: write } });
    await edit('   ');
    fireEvent.click(saveButton());
    expect(screen.getByRole('alert')).toHaveTextContent('กรุณาระบุชื่อ');
    expect(write).not.toHaveBeenCalled();
  });
  it('money refresh keeps the same focused input and draft; config revision change requires explicit latest review', async () => {
    const a = setup();
    const props = { ...a, refreshKey: 0 };
    const view = mount(props);
    await edit('draft remains');
    const input = screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง');
    input.focus();
    a.controller.releaseNextPeriod();
    view.update({ ...props, refreshKey: 1 });
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(screen.getByLabelText('ชื่อผู้รับเงินตัวอย่าง')).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('draft remains');
    a.controller.setBeneficiary({
      scope: a.scope,
      expectedRevision: a.controller.beneficiaryConfig().revision,
      idempotencyKey: 'other-save',
      displayName: 'new authoritative name',
      bankId: 'bank-scb',
      accountChoiceId: 'acct-1',
    });
    view.update({ ...props, refreshKey: 2 });
    expect(await screen.findByRole('button', { name: 'ใช้ข้อมูลล่าสุด' })).toBeEnabled();
    expect(saveButton()).toBeDisabled();
    expect(input).toHaveValue('draft remains');
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ข้อมูลล่าสุด' }));
    expect(input).toHaveValue('new authoritative name');
    expect(saveButton()).toBeEnabled();
  });
  it('unknown holds the original operation, performs one same-tick check, and never treats matching data as original success', async () => {
    const a = setup();
    a.controller.setBeneficiarySaveMode('unknown');
    const write = vi.fn(a.transport.setBeneficiary);
    const read = vi.fn(a.transport.beneficiaryConfig);
    mount({ ...a, transport: { ...a.transport, setBeneficiary: write, beneficiaryConfig: read } });
    await edit();
    fireEvent.click(saveButton());
    const check = await screen.findByRole('button', { name: 'ตรวจสอบข้อมูลปัจจุบัน' });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2)); // Initial read plus post-command invalidation.
    const hold = deferred<unknown>();
    read.mockImplementationOnce(() => hold.promise);
    act(() => {
      check.click();
      check.click();
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'กำลังตรวจสอบข้อมูลปัจจุบัน…' })).toBeDisabled();
    await act(async () => hold.resolve(a.controller.beneficiaryConfig()));
    expect(
      await screen.findByText(/ข้อมูลที่แสดงไม่ใช่การยืนยันผลการบันทึกครั้งก่อน/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('บันทึกบัญชีรับเงินตัวอย่างแล้ว โปรดดูสถานะปัจจุบัน'),
    ).not.toBeInTheDocument();
    expect(write).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' })).toBeEnabled();
  });
  it('superseded current-read result cannot clear a later scope or display its private name', async () => {
    const a = setup();
    a.controller.setBeneficiarySaveMode('unknown');
    const hold = deferred<unknown>();
    const read = vi.fn(a.transport.beneficiaryConfig);
    const transport = { ...a.transport, beneficiaryConfig: read };
    const view = mount({ ...a, transport });
    await edit('private A');
    fireEvent.click(saveButton());
    const check = await screen.findByRole('button', { name: 'ตรวจสอบข้อมูลปัจจุบัน' });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    read.mockImplementationOnce(() => hold.promise);
    fireEvent.click(check);
    const scopeB = previewScopeFor('missing-beneficiary', 'b');
    const b = createWithdrawalScenario({ scope: scopeB, storage: memoryStorage(), latencyMs: 0 });
    view.update({ scope: scopeB, transport: b.transport });
    expect(await screen.findByText('ยังไม่ได้ตั้งค่าบัญชีรับเงิน')).toBeInTheDocument();
    await act(async () => hold.resolve(a.controller.beneficiaryConfig()));
    expect(screen.queryByText('private A')).not.toBeInTheDocument();
    expect(screen.queryByText(/ไม่ใช่การยืนยันผล/)).not.toBeInTheDocument();
  });
  it('unmount and reset do not abort dispatched saves, and late outcomes do not reappear', async () => {
    const a = setup();
    const hold = deferred<unknown>();
    let signal!: AbortSignal;
    let command!: SetPayoutBeneficiaryCommandValue;
    const transport = {
      ...a.transport,
      setBeneficiary: vi.fn(
        (input: Parameters<WithdrawalBeneficiaryTransport['setBeneficiary']>[0]) => {
          signal = input.signal;
          command = input.command;
          return hold.promise;
        },
      ),
    };
    const view = mount({ ...a, transport, resetKey: 0 });
    await edit('late name');
    fireEvent.click(saveButton());
    a.controller.reset();
    view.update({ ...a, transport, resetKey: 1 });
    expect(signal.aborted).toBe(false);
    await act(async () =>
      hold.resolve({
        outcome: 'unknown',
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        expectedRevision: command.expectedRevision,
      }),
    );
    await screen.findByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' });
    expect(screen.queryByText(/ยังยืนยันผลการบันทึกไม่ได้/)).not.toBeInTheDocument();
    await edit();
    const hold2 = deferred<unknown>();
    transport.setBeneficiary.mockImplementationOnce((input) => {
      signal = input.signal;
      command = input.command;
      return hold2.promise;
    });
    fireEvent.click(saveButton());
    view.unmount();
    expect(signal.aborted).toBe(false);
    await act(async () =>
      hold2.resolve({
        outcome: 'unknown',
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        expectedRevision: command.expectedRevision,
      }),
    );
  });
  it('foreign config and transport read failure hide saved private facts and editing', async () => {
    const a = setup();
    const foreign = {
      ...a.controller.beneficiaryConfig(),
      scope: previewScopeFor('golden', 'b'),
      displayName: 'foreign secret',
    };
    const read = vi.fn(async () => foreign);
    const props = { ...a, transport: { ...a.transport, beneficiaryConfig: read } };
    const view = mount(props);
    expect(await screen.findByRole('alert')).toHaveTextContent('ข้อมูลบัญชีรับเงินไม่ตรง');
    expect(screen.queryByText('foreign secret')).not.toBeInTheDocument();
    read.mockRejectedValueOnce(new Error('network'));
    view.update({ ...props, refreshKey: 1 });
    expect(await screen.findByRole('alert')).toHaveTextContent('โหลดบัญชีรับเงินไม่สำเร็จ');
    expect(screen.queryByRole('button', { name: 'ดู/แก้ไขบัญชีรับเงิน' })).not.toBeInTheDocument();
  });
});
