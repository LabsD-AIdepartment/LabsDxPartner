import { CredentialAccount } from '@/features/partner-application/CredentialAccount';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AccountPage } from '@/features/account/AccountPage';
import { loadAccount, actOnAccount } from '@/features/account/model';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ScopedQueryProvider, IsolatedQueryProvider } from '@/shared/query/provider';
import { OperationsPage } from '@/features/operations/OperationsPage';
import {
  loadOps,
  moneyInput,
  submitOps,
  type DraftCommand,
  type OpsTransport,
} from '@/features/operations/model';
import { createAccountTransport, accountFixture, accountScope } from '../../dev/account-transport';
import { createOpsTransport, opsFixture, opsScope } from '../../dev/operations-transport';
it('keeps typed password fields mounted when account metadata finishes loading', async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  render(
    <ScopedQueryProvider scope={accountScope}>
      <AccountPage
        scope={accountScope}
        transport={{ ...createAccountTransport('ready'), read: () => pending }}
        onLogout={() => {}}
        credentials={<CredentialAccount name="ทดสอบ" onChanged={() => {}} showIdentity={false} />}
      />
    </ScopedQueryProvider>,
  );
  const input = screen.getByLabelText('รหัสผ่านปัจจุบัน');
  fireEvent.change(input, { target: { value: 'synthetic-password' } });
  await act(async () => finish(accountFixture()));
  await screen.findByText('ชื่อผู้ใช้: partner.demo');
  expect(screen.getByLabelText('รหัสผ่านปัจจุบัน')).toBe(input);
  expect(input).toHaveValue('synthetic-password');
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const signal = () => new AbortController().signal;
const payment: DraftCommand = {
  action: 'payment',
  partnerId: 'partner-1',
  statementId: 'statement-1',
  reference: 'transfer-1',
  evidenceRef: 'evidence-1',
  paidAt: '2026-09-09T10:00:00+07:00',
  cash: moneyInput('9700'),
  withholding: moneyInput('300'),
  other: moneyInput('0'),
};
const readOps = (transport: OpsTransport) =>
  loadOps(transport, { scope: opsScope, view: 'periods', cursor: null, signal: signal() });
describe('F07 account identity and recovery', () => {
  it('refuses a foreign user or agreement before exposing account details', async () => {
    for (const key of ['user', 'agreement', 'partner', 'revision']) {
      const v = accountFixture();
      if (key === 'user') v.data.userId = 'other';
      else if (key === 'agreement') v.data.agreement!.partnerId = 'other';
      else if (key === 'partner') {
        v.partnerId = 'other';
        v.data.agreement = null;
      } else v.permissionRevision = '2';
      await expect(
        loadAccount(
          { ...createAccountTransport('ready'), read: async () => v },
          accountScope,
          signal(),
        ),
      ).rejects.toThrow();
    }
  });
  it('shows username, agreement and recovery without social-method controls', async () => {
    render(
      <ScopedQueryProvider scope={accountScope}>
        <AccountPage
          scope={accountScope}
          transport={createAccountTransport('ready')}
          onLogout={vi.fn()}
        />
      </ScopedQueryProvider>,
    );
    await screen.findByText('ชื่อผู้ใช้: partner.demo');
    expect(screen.getByText('ข้อตกลงของคุณ')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'ลืมรหัสผ่านหรือเข้าใช้งานไม่ได้' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Google|Apple|เชื่อมบัญชี/)).not.toBeInTheDocument();
  });
  it('explains verified recovery without creating a link or mutating the account', async () => {
    const t = createAccountTransport('ready');
    const before = await loadAccount(t, accountScope, signal());
    const response = await actOnAccount(t, {
      scope: accountScope,
      expectedRevision: '1',
      idempotencyKey: 'recover',
      command: { action: 'recover' },
      signal: signal(),
    });
    expect(response.status).toBe('recovery-required');
    expect(response.message).toContain('ยังไม่มีการส่งลิงก์');
    expect(await loadAccount(t, accountScope, signal())).toEqual(before);
  });
  it('rejects obsolete social commands before any transport call', async () => {
    const t = { read: vi.fn(), act: vi.fn() };
    await expect(
      actOnAccount(t, {
        scope: accountScope,
        expectedRevision: '1',
        idempotencyKey: 'old',
        command: { action: 'link', provider: 'google' } as never,
        signal: signal(),
      }),
    ).rejects.toThrow();
    expect(t.act).not.toHaveBeenCalled();
  });
  it('rejects changed permission scope and reused keys with different commands', async () => {
    const t = createAccountTransport('ready'),
      r = {
        scope: accountScope,
        expectedRevision: '1',
        idempotencyKey: 'one',
        command: { action: 'logout' as const },
        signal: signal(),
      };
    const response = await t.act(r);
    expect(await t.act(r)).toEqual(response);
    await expect(t.act({ ...r, command: { action: 'recover' } })).rejects.toThrow('คำสั่งอื่น');
    await expect(
      t.act({ ...r, scope: { ...accountScope, permissionRevision: '2' } }),
    ).rejects.toThrow();
  });
  it('drops a late response after cancellation', async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      loadAccount(
        { ...createAccountTransport('ready'), read: async () => accountFixture() },
        accountScope,
        c.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
describe('F07 staff financial actions', () => {
  it('rejects a valid-money statement attached to a different reporting period', async () => {
    const v = opsFixture();
    v.periods.items[0].statement!.period = v.periods.items[1].period;
    await expect(readOps({ read: async () => v, act: vi.fn() })).rejects.toMatchObject({
      code: 'invalid',
    });
  });
  it('allows approved exclusions but blocks unresolved ones', async () => {
    const v = opsFixture();
    v.periods.items[1].excludedCount = 2;
    const transport: OpsTransport = {
      read: async () => v,
      act: vi.fn(async () => ({
        id: 'operation-1',
        requestId: 'request-1',
        actorId: opsScope.actorId,
        targetId: 'period-draft',
        status: 'complete',
        message: 'published',
      })),
    };
    await expect(
      submitOps(
        transport,
        opsScope,
        v,
        {
          action: 'publish',
          partnerId: 'partner-1',
          periodId: 'period-draft',
          generation: '2',
          evidenceRef: 'synthetic-draft-evidence',
        },
        'exclude-key',
        signal(),
      ),
    ).resolves.toMatchObject({ status: 'complete' });
  });
  it('converts decimal inputs exactly beyond Number safe integer', () => {
    expect(moneyInput('9007199254740993.01').minor).toBe('900719925474099301');
    for (const text of ['-1', '1.001', '1e3', '1,000', 'NaN', ''])
      expect(() => moneyInput(text)).toThrow();
  });
  it('records a split payment exactly once and rejects a stale second review', async () => {
    const t = createOpsTransport('ready'),
      before = await readOps(t);
    const first = await submitOps(t, opsScope, before, payment, 'payment-key', signal());
    expect(await submitOps(t, opsScope, before, payment, 'payment-key', signal())).toEqual(first);
    const after = await readOps(t),
      statement = after.periods.items[0].statement!;
    expect(statement.closing.minor).toBe('1552000');
    expect(statement.settled.minor).toBe('2184000');
    expect(statement.newEarnings.minor).toBe('3736000');
    await expect(
      submitOps(t, opsScope, before, payment, 'second-key', signal()),
    ).rejects.toMatchObject({ code: 'changed' });
    await expect(
      submitOps(
        t,
        opsScope,
        after,
        { ...payment, reference: 'different' },
        'payment-key',
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it.each([
    'overpay',
    'zero',
    'negative',
    'permission',
    'stale',
    'partner',
    'unreconciled',
  ] as const)('rejects %s before transport mutation', async (mode) => {
    const value = opsFixture();
    let draft: DraftCommand = payment;
    if (mode === 'overpay') draft = { ...payment, cash: moneyInput('30000') };
    if (mode === 'zero')
      draft = { ...payment, cash: moneyInput('0'), withholding: moneyInput('0') };
    if (mode === 'negative') draft = { ...payment, cash: { currency: 'THB', minor: '-100' } };
    if (mode === 'permission') value.capabilities = [];
    if (mode === 'stale') value.dataState = 'stale';
    if (mode === 'partner') draft = { ...payment, partnerId: 'other' };
    if (mode === 'unreconciled') {
      value.periods.items[1].unresolvedCount = 1;
      draft = {
        action: 'publish',
        partnerId: 'partner-1',
        periodId: 'period-draft',
        generation: '2',
        evidenceRef: 'synthetic-draft-evidence',
      };
    }
    const t = { read: vi.fn(), act: vi.fn() };
    await expect(submitOps(t, opsScope, value, draft, 'key', signal())).rejects.toThrow();
    expect(t.act).not.toHaveBeenCalled();
  });
  it('publishes reviewed controls then re-reads the new statement', async () => {
    const t = createOpsTransport('ready'),
      v = await readOps(t);
    await submitOps(
      t,
      opsScope,
      v,
      {
        action: 'publish',
        partnerId: 'partner-1',
        periodId: 'period-draft',
        generation: '2',
        evidenceRef: 'synthetic-draft-evidence',
      },
      'publish',
      signal(),
    );
    const p = (await readOps(t)).periods.items[1];
    expect(p.status).toBe('published');
    expect(p.statement!.closing.minor).toBe('1000000');
  });
  it('rejects foreign actor and a changed permission revision in read responses', async () => {
    for (const key of ['actorId', 'permissionRevision'] as const) {
      const v = opsFixture();
      v[key] = 'other';
      await expect(readOps({ read: async () => v, act: vi.fn() })).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });
  it('requires current staff authentication and hides editing for read-only staff', async () => {
    const t = createOpsTransport('reauth');
    await expect(
      submitOps(t, opsScope, await readOps(t), payment, 'key', signal()),
    ).rejects.toMatchObject({ code: 'reauth' });
    render(
      <IsolatedQueryProvider identity={['staff', 'read-only']}>
        <OperationsPage
          scope={opsScope}
          transport={createOpsTransport('read-only')}
          view="periods"
        />
      </IsolatedQueryProvider>,
    );
    await screen.findByText('เผยแพร่แล้ว');
    expect(screen.queryByText('บันทึกการชำระ')).toBeNull();
    expect(screen.queryByRole('button', { name: 'ตรวจการเผยแพร่' })).toBeNull();
  });
});
describe('shared confirmation lifecycle', () => {
  it('does not mutate before confirmation, blocks duplicate clicks, reuses the key on retry', async () => {
    let reject!: (e: Error) => void;
    const run = vi
        .fn()
        .mockImplementationOnce(() => new Promise((_, r) => (reject = r)))
        .mockResolvedValue({ message: 'done' }),
      done = vi.fn();
    render(
      <ConfirmAction title="ตรวจรายการ" onClose={vi.fn()} onConfirm={run} onComplete={done}>
        <p>partner-1 · statement-1 · ฿10,000 · evidence-1</p>
      </ConfirmAction>,
    );
    expect(run).not.toHaveBeenCalled();
    const b = screen.getByRole('button', { name: 'ยืนยัน' });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(run).toHaveBeenCalledOnce();
    await act(async () => reject(new Error('connection')));
    await screen.findByRole('alert');
    fireEvent.click(b);
    await waitFor(() => expect(done).toHaveBeenCalledWith('done'));
    expect(run.mock.calls[0][1]).toBe(run.mock.calls[1][1]);
  });
  it('aborts an in-flight action on unmount and discards its late success', async () => {
    let resolve!: (v: { message: string }) => void;
    const done = vi.fn(),
      run = vi.fn(() => new Promise<{ message: string }>((r) => (resolve = r)));
    const r = render(
      <ConfirmAction title="ตรวจรายการ" onClose={vi.fn()} onConfirm={run} onComplete={done}>
        <p>review</p>
      </ConfirmAction>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    r.unmount();
    expect((run.mock.calls[0] as unknown as [AbortSignal])[0].aborted).toBe(true);
    await act(async () => resolve({ message: 'late' }));
    expect(done).not.toHaveBeenCalled();
  });
});
