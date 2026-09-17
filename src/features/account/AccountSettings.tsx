'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  SaveContactPreferences,
  RequestIntentCommand,
  type AccountSettingsSnapshotValue,
  type AccountRequestKindValue,
  type RequestIntentCommandValue,
} from '@/contracts/account-settings';
import { usernameHint } from '@/contracts/credentials';
import {
  loadAccountSettings,
  saveContactPreferences,
  submitAccountRequest,
  type AccountSettingsScope,
  type AccountSettingsTransport,
} from './settings-model';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Field } from '@/shared/ui/Field';
import { Dialog } from '@/shared/ui/Dialog';
import { DataState } from '@/shared/ui/DataState';
import { dateLabel } from '@/shared/ui/format-date';
import forms from '@/shared/ui/forms.module.css';
import styles from './account-settings.module.css';

type Props = {
  scope: AccountSettingsScope;
  transport: AccountSettingsTransport;
  showIdentity?: boolean;
  payout?: ReactNode;
  onSnapshot?: (snapshot: AccountSettingsSnapshotValue) => void;
};
const requestLabels: Record<AccountRequestKindValue, string> = {
  'username-change': 'ขอเปลี่ยนชื่อผู้ใช้',
  'partnership-withdrawal': 'ขอยกเลิกการเป็นพาร์ตเนอร์',
  'account-deletion': 'ขอลบบัญชี',
};
const preferenceLabels = {
  withdrawals: 'การถอนและโอนเงิน',
  releases: 'ตัดรอบคอมมิชชันพร้อมถอน',
  agreements: 'ข้อตกลงและสัญญา',
  accountEvents: 'ความปลอดภัยและเหตุการณ์บัญชี',
};
export function AccountSettings(props: Props) {
  const authority = useRef({ transport: props.transport, generation: 0 });
  if (authority.current.transport !== props.transport)
    authority.current = {
      transport: props.transport,
      generation: authority.current.generation + 1,
    };
  return (
    <SettingsForm key={JSON.stringify([props.scope, authority.current.generation])} {...props} />
  );
}
function SettingsForm({ scope, transport, showIdentity = true, payout, onSnapshot }: Props) {
  const [snapshot, setSnapshot] = useState<AccountSettingsSnapshotValue | null>(null);
  const [email, setEmail] = useState(''),
    [phone, setPhone] = useState('');
  const [preferences, setPreferences] = useState<
    AccountSettingsSnapshotValue['preferences'] | null
  >(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [warning, setWarning] = useState('');
  const [stale, setStale] = useState(false),
    [reload, setReload] = useState(0);
  const [confirm, setConfirm] = useState<AccountRequestKindValue | null>(null);
  const [desiredUsername, setDesiredUsername] = useState('');
  const alive = useRef(false),
    locked = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  function accept(value: AccountSettingsSnapshotValue) {
    setSnapshot(value);
    setEmail(value.contact.email ?? '');
    setPhone(value.contact.phone ?? '');
    setPreferences(value.preferences);
    onSnapshotRef.current?.(value);
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadAccountSettings(transport, scope, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          accept(value);
          setStale(false);
          setLoading(false);
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setError('โหลดการตั้งค่าบัญชีไม่สำเร็จ');
          setLoading(false);
        }
      },
    );
    return () => {
      alive.current = false;
      controller.abort();
      mutation.current?.abort();
      mutation.current = null;
    };
  }, [scope.userId, scope.partnerId, scope.permissionRevision, transport, reload]);
  function handleError(cause: unknown) {
    const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
    if (code === 'stale-revision') {
      setStale(true);
      setError('ข้อมูลบัญชีเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง');
    } else
      setError(
        code === 'invalid-input'
          ? 'กรุณาตรวจสอบข้อมูลที่กรอก'
          : 'ยังยืนยันการบันทึกไม่ได้ โปรดโหลดข้อมูลล่าสุดก่อนทำรายการอีกครั้ง',
      );
    if (code !== 'invalid-input') setStale(true);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || !preferences || locked.current || stale || loading) return;
    const parsed = SaveContactPreferences.safeParse({
      contact: { email: email.trim() || null, phone: phone.trim() || null },
      preferences,
    });
    if (!parsed.success) {
      setError('กรุณากรอกอีเมลและเบอร์โทรให้ถูกต้อง หรือเว้นว่างหากยังไม่ระบุ');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const result = await saveContactPreferences(transport, {
        scope,
        expectedRevision: snapshot.revision,
        idempotencyKey: crypto.randomUUID(),
        command: parsed.data,
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted || mutation.current !== controller) return;
      accept(result.snapshot);
      setWarning(result.persistenceWarning ?? '');
      setMessage(
        result.persistenceWarning
          ? 'ข้อมูลเปลี่ยนในหน้านี้ แต่ยังบันทึกเก็บไว้ไม่ได้'
          : 'บันทึกข้อมูลติดต่อและการแจ้งเตือนแล้ว',
      );
    } catch (cause) {
      if (alive.current && mutation.current === controller) handleError(cause);
    } finally {
      if (alive.current && mutation.current === controller) {
        mutation.current = null;
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !snapshot ||
      !confirm ||
      locked.current ||
      stale ||
      loading ||
      snapshot.requests.some((item) => item.kind === confirm && item.status === 'pending')
    )
      return;
    const command: RequestIntentCommandValue =
      confirm === 'username-change' ? { kind: confirm, desiredUsername } : { kind: confirm };
    const parsed = RequestIntentCommand.safeParse(command);
    if (
      !parsed.success ||
      (parsed.data.kind === 'username-change' &&
        parsed.data.desiredUsername === snapshot.currentUsername)
    ) {
      setError('กรอกชื่อผู้ใช้ใหม่ให้ถูกต้องและต่างจากชื่อเดิม');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    mutation.current = controller;
    try {
      const result = await submitAccountRequest(transport, {
        scope,
        expectedRevision: snapshot.revision,
        idempotencyKey: crypto.randomUUID(),
        command: parsed.data,
        signal: controller.signal,
      });
      if (!alive.current || controller.signal.aborted || mutation.current !== controller) return;
      accept(result.snapshot);
      setWarning(result.persistenceWarning ?? '');
      setMessage(
        result.persistenceWarning
          ? 'คำขออยู่ในหน้านี้ แต่ยังบันทึกเก็บไว้ไม่ได้'
          : 'บันทึกคำขอแล้ว รอดำเนินการ',
      );
      setConfirm(null);
      setDesiredUsername('');
    } catch (cause) {
      if (alive.current && mutation.current === controller) handleError(cause);
    } finally {
      if (alive.current && mutation.current === controller) {
        mutation.current = null;
        locked.current = false;
        setBusy(false);
      }
    }
  }
  const feedback = (
    <>
      {error && <Text role="alert">{error}</Text>}
      {message && <Text role="status">{message}</Text>}
      {warning && <Text role="status">{warning}</Text>}
      {(stale || (!loading && !snapshot)) && (
        <Button
          disabled={busy}
          onClick={() => {
            setConfirm(null);
            setReload((x) => x + 1);
          }}
        >
          โหลดข้อมูลล่าสุด
        </Button>
      )}
    </>
  );
  if (loading && !snapshot) return <DataState state="loading" />;
  if (!snapshot || !preferences) return <div className={forms.stack}>{feedback}</div>;
  const pending = (kind: AccountRequestKindValue) =>
    snapshot.requests.some((item) => item.kind === kind && item.status === 'pending');
  const disabled = busy || stale || loading;
  return (
    <div className={forms.stack}>
      {showIdentity && (
        <Card title="ข้อมูลบัญชี">
          <Text variant="sectionTitle">{snapshot.displayName}</Text>
          <Text tone="muted">ชื่อผู้ใช้: {snapshot.currentUsername}</Text>
        </Card>
      )}
      {!confirm && feedback}
      <Card title="การเข้าสู่ระบบ">
        <div className={forms.form}>
          <Text>ชื่อผู้ใช้ปัจจุบัน: {snapshot.currentUsername}</Text>
          <Text variant="caption" tone="muted">
            ชื่อผู้ใช้เดิมยังใช้งานได้จนกว่าคำขอเปลี่ยนชื่อจะดำเนินการเสร็จ
          </Text>
          <div className={styles.actions}>
            <Button
              disabled={disabled || pending('username-change')}
              onClick={() => {
                setError('');
                setConfirm('username-change');
              }}
            >
              ขอเปลี่ยนชื่อผู้ใช้
            </Button>
            <LinkButton href="/access-preview">จัดการรหัสผ่าน</LinkButton>
          </div>
          <Text variant="caption" tone="muted">
            จัดการรหัสผ่านผ่านขั้นตอนตั้งบัญชีและเข้าสู่ระบบของตัวอย่าง
          </Text>
        </div>
      </Card>
      <Card title="ข้อมูลติดต่อและการแจ้งเตือน">
        <form onSubmit={save} className={forms.form} aria-busy={busy}>
          <div className={styles.contacts}>
            <Field
              label="อีเมล"
              type="email"
              autoComplete="email"
              maxLength={200}
              value={email}
              disabled={disabled}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Field
              label="เบอร์โทรศัพท์"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={phone}
              disabled={disabled}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <fieldset className={styles.preferences} disabled={disabled}>
            <legend>เลือกการแจ้งเตือน</legend>
            {Object.entries(preferenceLabels).map(([key, label]) => (
              <label key={key} className={styles.preference}>
                <input
                  type="checkbox"
                  checked={preferences[key as keyof typeof preferences]}
                  onChange={(event) =>
                    setPreferences({ ...preferences, [key]: event.target.checked })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <Text variant="caption" tone="muted">
            การตั้งค่านี้ใช้กับการแจ้งเตือนในตัวอย่าง ยังไม่มีการส่งอีเมลหรือ SMS
          </Text>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={disabled}>
              {busy ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
            </Button>
          </div>
        </form>
      </Card>
      {payout}
      <Card title="สถานะพาร์ตเนอร์และบัญชี">
        <div className={forms.form}>
          <Text tone="muted">ส่งคำขอให้ตรวจสอบก่อนยกเลิกการเป็นพาร์ตเนอร์หรือลบบัญชี</Text>
          <div className={styles.actions}>
            {(['partnership-withdrawal', 'account-deletion'] as const).map((kind) => (
              <Button
                key={kind}
                disabled={disabled || pending(kind)}
                onClick={() => {
                  setError('');
                  setConfirm(kind);
                }}
              >
                {requestLabels[kind]}
              </Button>
            ))}
          </div>
          {snapshot.requests.length > 0 && (
            <ul className={styles.requests} aria-label="คำขอเกี่ยวกับบัญชี">
              {snapshot.requests.map((item) => (
                <li key={item.id}>
                  <Text variant="label">
                    {requestLabels[item.kind]}
                    {item.desiredUsername ? ` เป็น ${item.desiredUsername}` : ''}
                  </Text>
                  <Text variant="caption" tone="muted">
                    รอดำเนินการ · {dateLabel(item.createdAt)} · {item.reference}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Dialog
        open={confirm !== null}
        title={confirm ? requestLabels[confirm] : 'คำขอเกี่ยวกับบัญชี'}
        onClose={() => {
          if (!busy) {
            setConfirm(null);
            setError('');
          }
        }}
      >
        <form onSubmit={request} className={forms.form} aria-busy={busy}>
          <Text>
            {confirm === 'username-change'
              ? 'ชื่อผู้ใช้ปัจจุบันจะยังไม่เปลี่ยนเมื่อบันทึกคำขอ'
              : confirm === 'account-deletion'
                ? 'การยืนยันนี้เป็นการบันทึกคำขอ บัญชีและประวัติการเงินยังไม่ถูกลบ'
                : 'การยืนยันนี้เป็นการบันทึกคำขอ สถานะพาร์ตเนอร์ยังไม่เปลี่ยน'}
          </Text>
          <Text variant="caption" tone="muted">
            คำขอจะบันทึกในตัวอย่างนี้ ยังไม่มีการส่งถึงผู้ดูแล
          </Text>
          {confirm === 'username-change' && (
            <Field
              label="ชื่อผู้ใช้ใหม่ที่ต้องการ"
              hint={usernameHint}
              required
              minLength={3}
              maxLength={30}
              value={desiredUsername}
              disabled={disabled}
              onChange={(event) => setDesiredUsername(event.target.value)}
            />
          )}
          {confirm && feedback}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={disabled}>
              {busy ? 'กำลังบันทึก…' : 'ยืนยันคำขอ'}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirm(null);
                setError('');
              }}
            >
              ยกเลิก
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
