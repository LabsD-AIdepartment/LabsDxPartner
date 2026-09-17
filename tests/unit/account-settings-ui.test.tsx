import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { usePreviewAccountSettings } from '../../dev/AccountSettingsPreview';
import { PreviewNotifications } from '../../dev/PreviewNotifications';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { AccountSettings } from '@/features/account/AccountSettings';
import {
  createAccountSettingsTransport,
  memoryAccountStorage,
} from '../../dev/account-settings-transport';
import { loadAccountSettings, saveContactPreferences } from '@/features/account/settings-model';
const scope = {
  userId: 'account-ui-user',
  partnerId: 'account-ui-partner',
  permissionRevision: '1',
};
function fixture() {
  const storage = memoryAccountStorage();
  const make = () =>
    createAccountSettingsTransport({
      scope,
      storage,
      initial: { displayName: 'พาร์ตเนอร์ A', currentUsername: 'partner.a' },
      latencyMs: 0,
    });
  return { storage, make, transport: make() };
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('AccountSettings presentation', () => {
  it('saves contact and notification changes through the validated scope and restores them on reload', async () => {
    const { transport, make } = fixture();
    const onSnapshot = vi.fn();
    const rendered = render(
      <AccountSettings scope={scope} transport={transport} onSnapshot={onSnapshot} />,
    );
    fireEvent.change(await screen.findByLabelText('อีเมล'), {
      target: { value: 'partner@example.test' },
    });
    fireEvent.change(screen.getByLabelText('เบอร์โทรศัพท์'), { target: { value: '0812345678' } });
    fireEvent.click(screen.getByLabelText('ตัดรอบคอมมิชชันพร้อมถอน'));
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    await screen.findByText('บันทึกข้อมูลติดต่อและการแจ้งเตือนแล้ว');
    expect(onSnapshot.mock.lastCall?.[0].preferences.releases).toBe(false);
    rendered.unmount();
    render(<AccountSettings scope={scope} transport={make()} />);
    expect(await screen.findByLabelText('อีเมล')).toHaveValue('partner@example.test');
    expect(screen.getByLabelText('ตัดรอบคอมมิชชันพร้อมถอน')).not.toBeChecked();
  });
  it('records deletion only after confirmation and shows a pending request without deleting identity', async () => {
    const { transport } = fixture();
    render(<AccountSettings scope={scope} transport={transport} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ขอลบบัญชี' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/บัญชีและประวัติการเงินยังไม่ถูกลบ/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByRole('list', { name: 'คำขอเกี่ยวกับบัญชี' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ขอลบบัญชี' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ยืนยันคำขอ' }));
    expect(await screen.findByText('บันทึกคำขอแล้ว รอดำเนินการ')).toBeVisible();
    expect(screen.getByText('ชื่อผู้ใช้ปัจจุบัน: partner.a')).toBeVisible();
    expect(screen.getByRole('button', { name: 'ขอลบบัญชี' })).toBeDisabled();
  });
  it('keeps current login username after a change request and links password work to the existing lifecycle', async () => {
    const { transport } = fixture();
    render(<AccountSettings scope={scope} transport={transport} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ขอเปลี่ยนชื่อผู้ใช้' }));
    fireEvent.change(screen.getByRole('textbox', { name: /ชื่อผู้ใช้ใหม่ที่ต้องการ/ }), {
      target: { value: 'new.partner' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'ยืนยันคำขอ' }));
    await screen.findByText('ขอเปลี่ยนชื่อผู้ใช้ เป็น new.partner');
    expect(screen.getByText('ชื่อผู้ใช้ปัจจุบัน: partner.a')).toBeVisible();
    expect(screen.getByRole('link', { name: 'จัดการรหัสผ่าน' })).toHaveAttribute(
      'href',
      '/access-preview',
    );
    expect(screen.queryByLabelText('รหัสผ่านปัจจุบัน')).not.toBeInTheDocument();
  });
  it('blocks stale writes until a fresh read and keeps another save intact', async () => {
    const { transport } = fixture();
    render(<AccountSettings scope={scope} transport={transport} />);
    await screen.findByLabelText('อีเมล');
    const snapshot = await loadAccountSettings(transport, scope, new AbortController().signal);
    await saveContactPreferences(transport, {
      scope,
      expectedRevision: snapshot.revision,
      idempotencyKey: 'other-save',
      command: {
        contact: { email: 'other@example.test', phone: null },
        preferences: snapshot.preferences,
      },
      signal: new AbortController().signal,
    });
    fireEvent.change(screen.getByLabelText('อีเมล'), { target: { value: 'old@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    await screen.findByText('ข้อมูลบัญชีเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง');
    expect(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }));
    await waitFor(() => expect(screen.getByLabelText('อีเมล')).toHaveValue('other@example.test'));
  });
  it('discloses rejected persistence and clears old drafts when authority changes', async () => {
    const transport = createAccountSettingsTransport({
      scope,
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('disabled');
        },
        removeItem: () => {},
      },
      initial: { displayName: 'A', currentUsername: 'partner.a' },
      latencyMs: 0,
    });
    const rendered = render(<AccountSettings scope={scope} transport={transport} />);
    fireEvent.change(await screen.findByLabelText('อีเมล'), {
      target: { value: 'a@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    await screen.findByText('ยังยืนยันการบันทึกไม่ได้ โปรดโหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง');
    expect(screen.queryByText('บันทึกข้อมูลติดต่อและการแจ้งเตือนแล้ว')).not.toBeInTheDocument();
    const otherScope = { ...scope, partnerId: 'other-partner' };
    const other = createAccountSettingsTransport({
      scope: otherScope,
      storage: memoryAccountStorage(),
      initial: { displayName: 'B', currentUsername: 'partner.b' },
      latencyMs: 0,
    });
    rendered.rerender(<AccountSettings scope={otherScope} transport={other} />);
    expect(await screen.findByLabelText('อีเมล')).toHaveValue('');
    expect(screen.getByText('ชื่อผู้ใช้ปัจจุบัน: partner.b')).toBeVisible();
  });
});

it('keeps the notification bell accessible when release notices are turned off', () => {
  render(
    <PreviewNotifications
      statementHref={() => '/transactions-preview?view=withdrawals'}
      preferences={{ withdrawals: true, releases: false, agreements: true, accountEvents: true }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /การแจ้งเตือน/ }));
  expect(screen.queryByText('สรุปคอมมิชชันพร้อมตรวจสอบ')).not.toBeInTheDocument();
});

function ComposedSettings({ identity }: { identity: 'a' | 'b' }) {
  const settings = usePreviewAccountSettings(
    {
      userId: 'composition-settings-user',
      partnerId: 'composition-settings-' + identity,
      permissionRevision: 'generation-6',
    },
    identity,
  );
  return settings.transport ? (
    <AccountSettings scope={settings.scope} transport={settings.transport} />
  ) : null;
}
it('composes browser settings after mount and fences identities on the same mounted page', async () => {
  const rendered = render(<ComposedSettings identity="a" />);
  fireEvent.change(await screen.findByLabelText('อีเมล'), {
    target: { value: 'only-a@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
  await screen.findByText('บันทึกข้อมูลติดต่อและการแจ้งเตือนแล้ว');
  rendered.rerender(<ComposedSettings identity="b" />);
  expect(await screen.findByLabelText('อีเมล')).toHaveValue('');
  expect(screen.getByText('ชื่อผู้ใช้ปัจจุบัน: partner.b')).toBeVisible();
  rendered.rerender(<ComposedSettings identity="a" />);
  expect(await screen.findByLabelText('อีเมล')).toHaveValue('only-a@example.test');
});

it.each(['save', 'request'] as const)(
  'aborts a pending %s before leaving its scope, without persisting it',
  async (operation) => {
    const storage = memoryAccountStorage();
    const base = createAccountSettingsTransport({
      scope,
      storage,
      initial: { displayName: 'A', currentUsername: 'partner.a' },
      latencyMs: 45,
    });
    let commandSignal: AbortSignal | undefined;
    const transport = {
      ...base,
      saveContactPreferences: (request: Parameters<typeof base.saveContactPreferences>[0]) => {
        commandSignal = request.signal;
        return base.saveContactPreferences(request);
      },
      requestIntent: (request: Parameters<typeof base.requestIntent>[0]) => {
        commandSignal = request.signal;
        return base.requestIntent(request);
      },
    };
    const view = render(<AccountSettings scope={scope} transport={transport} />);
    await screen.findByLabelText('อีเมล');
    if (operation === 'save') {
      fireEvent.change(screen.getByLabelText('อีเมล'), {
        target: { value: 'uncommitted@example.test' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'ขอลบบัญชี' }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'ยืนยันคำขอ' }),
      );
    }
    expect(commandSignal?.aborted).toBe(false);
    const otherScope = { ...scope, partnerId: 'new-scope-partner' };
    const other = createAccountSettingsTransport({
      scope: otherScope,
      storage,
      initial: { displayName: 'B', currentUsername: 'partner.b' },
      latencyMs: 0,
    });
    view.rerender(<AccountSettings scope={otherScope} transport={other} />);
    expect(commandSignal?.aborted).toBe(true);
    expect(await screen.findByLabelText('อีเมล')).toHaveValue('');
    const persisted = await loadAccountSettings(base, scope, new AbortController().signal);
    expect(persisted.contact.email).toBeNull();
    expect(persisted.requests).toHaveLength(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
);

it('does not claim rollback or failure when unmount follows a committed save before its response', async () => {
  const { transport: base } = fixture();
  let finish!: (result: unknown) => void;
  let committed!: () => void;
  const didCommit = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let signal: AbortSignal | undefined;
  const transport = {
    ...base,
    saveContactPreferences: async (request: Parameters<typeof base.saveContactPreferences>[0]) => {
      signal = request.signal;
      const result = await base.saveContactPreferences(request);
      committed();
      return new Promise((resolve) => {
        finish = () => resolve(result);
      });
    },
  };
  const view = render(<AccountSettings scope={scope} transport={transport} />);
  fireEvent.change(await screen.findByLabelText('อีเมล'), {
    target: { value: 'committed@example.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'บันทึกการตั้งค่า' }));
  await didCommit;
  view.unmount();
  expect(signal?.aborted).toBe(true);
  finish(undefined);
  render(<AccountSettings scope={scope} transport={base} />);
  expect(await screen.findByLabelText('อีเมล')).toHaveValue('committed@example.test');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
