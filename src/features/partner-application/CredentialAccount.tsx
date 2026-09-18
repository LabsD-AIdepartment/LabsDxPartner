'use client';
import { passwordPolicy } from '@/contracts/credentials';
import { useState, type FormEvent } from 'react';
import { ChangePassword } from '@/contracts/passwords';
import { PasswordChanged } from '@/contracts/credential-responses';
import { credentialErrorText } from '@/features/login/credential-client';
import { useCredentialEnvironment } from '@/features/login/CredentialEnvironment';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { PasswordField } from '@/shared/ui/PasswordField';
import forms from '@/shared/ui/forms.module.css';
export function CredentialAccount({
  name,
  onChanged,
  showIdentity = true,
  embedded = false,
  disabled = false,
  onBusyChange,
}: {
  name: string;
  onChanged: () => void;
  showIdentity?: boolean;
  embedded?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { request } = useCredentialEnvironment();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || disabled) return;
    const values = new FormData(e.currentTarget);
    const input = ChangePassword.safeParse({
      currentPassword: values.get('currentPassword'),
      password: values.get('password'),
      passwordConfirmation: values.get('passwordConfirmation'),
      idempotencyKey: crypto.randomUUID(),
    });
    if (!input.success) {
      setError(
        `ใช้รหัสผ่าน ${passwordPolicy.minLength}–${passwordPolicy.maxLength} ตัวอักษร และยืนยันให้ตรงกัน`,
      );
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      await request('/api/access/passwords/change', input.data, PasswordChanged);
      onChanged();
    } catch (e) {
      setError(credentialErrorText(e));
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  const passwordForm = (
    <form onSubmit={submit} className={forms.form} aria-busy={busy}>
      <PasswordField
        label="รหัสผ่านปัจจุบัน"
        name="currentPassword"
        autoComplete="current-password"
        required
        maxLength={passwordPolicy.maxLength}
        disabled={busy || disabled}
      />
      <PasswordField
        label="รหัสผ่านใหม่"
        showStrength
        name="password"
        autoComplete="new-password"
        hint={`อย่างน้อย ${passwordPolicy.minLength} ตัวอักษร`}
        required
        minLength={passwordPolicy.minLength}
        maxLength={passwordPolicy.maxLength}
        disabled={busy || disabled}
      />
      <PasswordField
        label="ยืนยันรหัสผ่านใหม่"
        name="passwordConfirmation"
        autoComplete="new-password"
        required
        minLength={passwordPolicy.minLength}
        maxLength={passwordPolicy.maxLength}
        disabled={busy || disabled}
      />
      {error && <Text role="alert">{error}</Text>}
      <Button type="submit" variant="primary" disabled={busy || disabled}>
        {busy ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}
      </Button>
    </form>
  );
  if (embedded) return passwordForm;
  return (
    <div className={forms.stack}>
      {showIdentity && (
        <Card title="บัญชีของคุณ">
          <Text>{name}</Text>
          <Text tone="muted">
            ต้องการแก้ข้อมูลบัญชีหรือสิทธิ์เข้าถึง ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณ
          </Text>
        </Card>
      )}
      <Card
        title="เปลี่ยนรหัสผ่าน"
        description="เปลี่ยนสำเร็จแล้ว คุณจะต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์"
      >
        {passwordForm}
      </Card>
    </div>
  );
}
