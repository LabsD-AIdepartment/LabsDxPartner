'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { AccountIdentityChanged, ChangeAccountIdentity } from '@/contracts/account-identity';
import { passwordPolicy, usernameHint } from '@/contracts/credentials';
import { scopeKey, type QueryScope } from '@/shared/query/keys';
import { Card } from '@/shared/ui/Card';
import { Dialog } from '@/shared/ui/Dialog';
import { Field } from '@/shared/ui/Field';
import { PasswordField } from '@/shared/ui/PasswordField';
import { Button } from '@/shared/ui/Button';
import { Text } from '@/shared/ui/Text';
import { DataState } from '@/shared/ui/DataState';
import { useCredentialEnvironment } from '@/features/login/CredentialEnvironment';
import { credentialErrorText } from '@/features/login/credential-client';
import { CredentialAccount } from '@/features/partner-application/CredentialAccount';
import { loadAccount, type AccountTransport } from './model';
import forms from '@/shared/ui/forms.module.css';
import styles from './account-identity.module.css';

type Props = { scope: QueryScope; transport: AccountTransport; onChanged: () => void };
export function AccountIdentityCard(props: Props) {
  return <IdentityCard key={JSON.stringify(scopeKey(props.scope))} {...props} />;
}
function IdentityCard({ scope, transport, onChanged }: Props) {
  const q = useQuery({
    queryKey: [...scopeKey(scope), 'account'],
    queryFn: ({ signal }) => loadAccount(transport, scope, signal),
  });
  const [editing, setEditing] = useState<{ name: string; username: string } | null>(null);
  const data = q.data?.data;
  const available = !!data && !q.error && q.data?.dataState === 'ready';
  return (
    <>
      <Card
        title="บัญชีของคุณ"
        action={
          <Button
            aria-label="แก้ไขบัญชีของคุณ"
            disabled={!available}
            onClick={() => data && setEditing({ name: data.displayName, username: data.username })}
          >
            <Pencil size={16} />
            แก้ไข
          </Button>
        }
      >
        {available && data ? (
          <dl className={styles.facts}>
            <div>
              <dt>ชื่อที่แสดง</dt>
              <dd>{data.displayName}</dd>
            </div>
            <div>
              <dt>ชื่อผู้ใช้</dt>
              <dd>{data.username}</dd>
            </div>
            <div>
              <dt>รหัสผ่าน</dt>
              <dd aria-label="รหัสผ่านถูกซ่อน">••••••••</dd>
            </div>
          </dl>
        ) : (
          <DataState
            state={
              q.error
                ? 'error'
                : q.isPending
                  ? 'loading'
                  : q.data?.dataState === 'ready'
                    ? 'unavailable'
                    : (q.data?.dataState ?? 'unavailable')
            }
            message={q.error ? 'โหลดบัญชีไม่สำเร็จ' : undefined}
            onRetry={() => void q.refetch()}
          />
        )}
      </Card>
      {editing && (
        <IdentityEditor
          scope={scope}
          initial={editing}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
function IdentityEditor({
  scope,
  initial,
  onClose,
  onChanged,
}: {
  scope: QueryScope;
  initial: { name: string; username: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const { request } = useCredentialEnvironment();
  const [name, setName] = useState(initial.name),
    [username, setUsername] = useState(initial.username);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const [passwordBusy, setPasswordBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const finish = () => {
    if (mounted.current) onChanged();
  };
  return (
    <Dialog
      open
      title="แก้ไขบัญชีของคุณ"
      onClose={() => {
        if (!lock.current && !passwordBusy) onClose();
      }}
    >
      <form
        className={forms.form}
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current || passwordBusy) return;
          const values = new FormData(event.currentTarget);
          const input = ChangeAccountIdentity.safeParse({
            partnerId: scope.partnerId,
            permissionRevision: scope.permissionRevision,
            expectedUserId: scope.userId,
            expectedName: initial.name,
            expectedUsername: initial.username,
            name,
            username,
            currentPassword: values.get('currentPassword'),
            idempotencyKey: crypto.randomUUID(),
          });
          if (!input.success) {
            setError('กรุณากรอกชื่อ ชื่อผู้ใช้ และรหัสผ่านปัจจุบันให้ถูกต้อง');
            return;
          }
          lock.current = true;
          setBusy(true);
          setError('');
          try {
            await request('/api/access/account/identity', input.data, AccountIdentityChanged);
            finish();
          } catch (error) {
            if (!mounted.current) return;
            setError(credentialErrorText(error));
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <Field
          label="ชื่อที่แสดง"
          name="name"
          autoComplete="name"
          maxLength={200}
          required
          value={name}
          disabled={busy || passwordBusy}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="ชื่อผู้ใช้"
          name="username"
          autoComplete="username"
          maxLength={30}
          required
          value={username}
          hint={usernameHint}
          disabled={busy || passwordBusy}
          onChange={(e) => setUsername(e.target.value)}
        />
        <PasswordField
          label="รหัสผ่านปัจจุบันเพื่อยืนยัน"
          name="currentPassword"
          autoComplete="current-password"
          maxLength={passwordPolicy.maxLength}
          required
          disabled={busy || passwordBusy}
        />
        <Text variant="caption" tone="muted">
          บันทึกแล้วต้องเข้าสู่ระบบใหม่ด้วยชื่อผู้ใช้ที่ตั้งไว้
        </Text>
        {error && <Text role="alert">{error}</Text>}
        <Button
          type="submit"
          variant="primary"
          disabled={
            busy || passwordBusy || (name === initial.name && username === initial.username)
          }
        >
          {busy ? 'กำลังบันทึก…' : 'บันทึกชื่อและชื่อผู้ใช้'}
        </Button>
      </form>
      <details className={styles.password}>
        <summary>เปลี่ยนรหัสผ่าน</summary>
        <Text variant="caption" tone="muted">
          เปลี่ยนสำเร็จแล้ว คุณจะต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์
        </Text>
        <CredentialAccount
          name={initial.name}
          onChanged={finish}
          disabled={busy}
          onBusyChange={setPasswordBusy}
          showIdentity={false}
          embedded
        />
      </details>
    </Dialog>
  );
}
