'use client';
import { useCredentialEnvironment } from './CredentialEnvironment';
import { useState, type FormEvent } from 'react';
import { ActivateAccount } from '@/contracts/invitations';
import { CredentialLogin } from '@/contracts/credentials';
import { ActivatedAccount, InvitationContext } from '@/contracts/credential-responses';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Field } from '@/shared/ui/Field';
import { PasswordField } from '@/shared/ui/PasswordField';
import { Text } from '@/shared/ui/Text';
import { credentialErrorText } from './credential-client';
import { useBearerLink } from './useBearerLink';
import forms from '@/shared/ui/forms.module.css';
export function InvitePage() {
  const environment = useCredentialEnvironment();
  const invitation = useBearerLink('/api/access/invitations/inspect', InvitationContext);
  const [existing, setExisting] = useState(false),
    [busy, setBusy] = useState(false),
    [completed, setCompleted] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const credentials = { username: values.get('username'), password: values.get('password') };
    const parsed = existing
      ? CredentialLogin.safeParse(credentials)
      : ActivateAccount.safeParse({
          ...credentials,
          token: invitation.token,
          passwordConfirmation: values.get('passwordConfirmation'),
        });
    if (!parsed.success) {
      setError(
        existing
          ? 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ถูกต้อง'
          : 'ตรวจสอบชื่อผู้ใช้ รหัสผ่านอย่างน้อย 12 ตัวอักษร และยืนยันรหัสผ่านให้ตรงกัน',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (existing) {
        await environment.signIn(parsed.data.username, parsed.data.password);
        await environment.request(
          '/api/access/invitations/accept',
          { token: invitation.token },
          ActivatedAccount,
        );
        setCompleted(true);
        environment.clearLink();
      } else {
        await environment.request(
          '/api/access/invitations/register',
          parsed.data,
          ActivatedAccount,
        );
        setCompleted(true);
        environment.clearLink();
        await environment.signIn(parsed.data.username, parsed.data.password);
      }
      environment.navigate('/overview');
    } catch (failure) {
      setError(credentialErrorText(failure));
      setBusy(false);
    }
  }
  if (completed)
    return (
      <>
        <h2>บัญชีของคุณพร้อมแล้ว</h2>
        <Text>
          รับคำเชิญเรียบร้อยแล้ว หากยังไม่ได้เข้าสู่ระบบ ให้ใช้ชื่อผู้ใช้และรหัสผ่านที่ตั้งไว้
        </Text>
        {error && <Text role="alert">{error}</Text>}
        <LinkButton href="/login" variant="primary">
          ไปหน้าเข้าสู่ระบบ
        </LinkButton>
      </>
    );
  return (
    <>
      <h2>{existing ? 'รับคำเชิญด้วยบัญชีเดิม' : 'ตั้งค่าบัญชีของคุณ'}</h2>
      {invitation.error ? (
        <Text role="alert">{invitation.error}</Text>
      ) : !invitation.data ? (
        <Text role="status">กำลังตรวจสอบคำเชิญ…</Text>
      ) : (
        <>
          <Text>
            คำเชิญสำหรับ {invitation.data.recipientName} · {invitation.data.partnerName}
          </Text>
          <form onSubmit={submit} className={forms.form} aria-busy={busy}>
            <Field
              label="ชื่อผู้ใช้"
              hint="ใช้ a–z ตัวเลข จุด หรือ _ จำนวน 3–30 ตัว"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={3}
              maxLength={30}
              disabled={busy}
            />
            <PasswordField
              label="รหัสผ่าน"
              hint={existing ? undefined : 'อย่างน้อย 12 ตัวอักษร'}
              name="password"
              autoComplete={existing ? 'current-password' : 'new-password'}
              required
              minLength={existing ? 1 : 12}
              maxLength={128}
              disabled={busy}
            />
            {!existing && (
              <PasswordField
                label="ยืนยันรหัสผ่าน"
                name="passwordConfirmation"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
              />
            )}
            {error && <Text role="alert">{error}</Text>}
            <Button variant="primary" type="submit" disabled={busy}>
              {busy
                ? 'กำลังดำเนินการ…'
                : existing
                  ? 'เข้าสู่ระบบและรับคำเชิญ'
                  : 'สร้างบัญชีและเข้าสู่ระบบ'}
            </Button>
          </form>
          <div className={forms.actions}>
            <Button
              disabled={busy}
              onClick={() => {
                setExisting(!existing);
                setError('');
              }}
            >
              {existing ? 'ตั้งค่าบัญชีใหม่' : 'มีบัญชีอยู่แล้ว'}
            </Button>
          </div>
        </>
      )}
      <Text tone="muted">
        ลิงก์ใช้ไม่ได้ หรือสร้างบัญชีแล้วแต่เข้าไม่ได้ ให้ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณ
      </Text>
      <LinkButton href="/login">ไปหน้าเข้าสู่ระบบ</LinkButton>
    </>
  );
}
