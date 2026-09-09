'use client';
import { passwordPolicy } from '@/contracts/credentials';
import { useCredentialEnvironment } from './CredentialEnvironment';
import { useState, type FormEvent } from 'react';
import { ResetPassword } from '@/contracts/passwords';
import { PasswordChanged, PasswordResetContext } from '@/contracts/credential-responses';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { PasswordField } from '@/shared/ui/PasswordField';
import { Text } from '@/shared/ui/Text';
import { credentialErrorText } from './credential-client';
import { useBearerLink } from './useBearerLink';
import forms from '@/shared/ui/forms.module.css';
export function ResetPasswordPage() {
  const environment = useCredentialEnvironment();
  const link = useBearerLink('/api/access/passwords/inspect', PasswordResetContext);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const input = ResetPassword.safeParse({
      token: link.token,
      password: values.get('password'),
      passwordConfirmation: values.get('passwordConfirmation'),
    });
    if (!input.success) {
      setError(`ใช้รหัสผ่านอย่างน้อย ${passwordPolicy.minLength} ตัวอักษร และยืนยันให้ตรงกัน`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await environment.request('/api/access/passwords/reset', input.data, PasswordChanged);
      setDone(true);
      environment.clearLink();
    } catch (failure) {
      setError(credentialErrorText(failure));
    } finally {
      setBusy(false);
    }
  }
  if (done)
    return (
      <>
        <h2>ตั้งรหัสผ่านใหม่แล้ว</h2>
        <Text>กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่ อุปกรณ์อื่นจะต้องเข้าสู่ระบบอีกครั้งด้วย</Text>
        <LinkButton variant="primary" href="/login">
          เข้าสู่ระบบ
        </LinkButton>
      </>
    );
  return (
    <>
      <h2>ตั้งรหัสผ่านใหม่</h2>
      {link.error ? (
        <Text role="alert">{link.error}</Text>
      ) : !link.data ? (
        <Text role="status">กำลังตรวจสอบลิงก์…</Text>
      ) : (
        <>
          <Text>บัญชี {link.data.username}</Text>
          <form onSubmit={submit} className={forms.form} aria-busy={busy}>
            <input
              type="hidden"
              name="username"
              autoComplete="username"
              value={link.data.username}
            />
            <PasswordField
              label="รหัสผ่านใหม่"
              showStrength
              name="password"
              hint={`อย่างน้อย ${passwordPolicy.minLength} ตัวอักษร`}
              autoComplete="new-password"
              required
              minLength={passwordPolicy.minLength}
              maxLength={passwordPolicy.maxLength}
              disabled={busy}
            />
            <PasswordField
              label="ยืนยันรหัสผ่าน"
              name="passwordConfirmation"
              autoComplete="new-password"
              required
              minLength={passwordPolicy.minLength}
              maxLength={passwordPolicy.maxLength}
              disabled={busy}
            />
            {error && <Text role="alert">{error}</Text>}
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
            </Button>
          </form>
        </>
      )}
      <Text tone="muted">หากลิงก์ใช้ไม่ได้ ให้ติดต่อผู้ดูแล Labs D เพื่อขอลิงก์ใหม่</Text>
      <LinkButton href="/login">กลับไปเข้าสู่ระบบ</LinkButton>
    </>
  );
}
