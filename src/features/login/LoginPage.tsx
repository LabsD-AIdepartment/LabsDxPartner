'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Ticket } from 'lucide-react';
import { CredentialLogin } from '@/contracts/credentials';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Field';
import { PasswordField } from '@/shared/ui/PasswordField';
import { Text } from '@/shared/ui/Text';
import { safeReturnTo } from './access';
import { signIn, credentialErrorText } from './credential-client';
import forms from '@/shared/ui/forms.module.css';
import styles from './login.module.css';
export function LoginPage({ next, onPreview }: { next: string; onPreview?: () => void }) {
  const [inviteOpen, setInviteOpen] = useState(false),
    [forgot, setForgot] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const input = CredentialLogin.safeParse({
      username: values.get('username'),
      password: values.get('password'),
    });
    if (!input.success) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ถูกต้อง');
      return;
    }
    if (onPreview) {
      onPreview();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(input.data.username, input.data.password, next);
      window.location.assign(safeReturnTo(next));
    } catch (failure) {
      setError(credentialErrorText(failure));
      setBusy(false);
    }
  }
  return (
    <>
      <div className={styles.welcomeIcon}>
        <ArrowRight aria-hidden size={25} />
      </div>
      <h2>ยินดีต้อนรับ พาร์ทเนอร์</h2>
      <Text variant="caption" tone="muted" className={styles.description}>
        เข้าสู่ระบบเพื่อดูผลงานและรายได้ของคุณ
      </Text>
      <form onSubmit={submit} className={forms.form} aria-busy={busy}>
        <Field
          label="ชื่อผู้ใช้"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={30}
          disabled={busy}
        />
        <PasswordField
          label="รหัสผ่าน"
          name="password"
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={busy}
        />
        {error && <Text role="alert">{error}</Text>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          <ArrowRight size={18} aria-hidden />
        </Button>
      </form>
      {onPreview && (
        <Text variant="caption" tone="muted" className={styles.availability}>
          ตัวอย่างการเข้าสู่ระบบ · ไม่เชื่อมบัญชีจริง
        </Text>
      )}
      <div className={forms.actions}>
        <Button aria-expanded={forgot} onClick={() => setForgot(!forgot)}>
          ลืมรหัสผ่าน
        </Button>
      </div>
      {forgot && (
        <Text className={styles.help}>
          ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณ เมื่อยืนยันเจ้าของบัญชีแล้ว
          ทีมจะส่งลิงก์ให้คุณตั้งรหัสผ่านใหม่ด้วยตัวเอง
        </Text>
      )}
      <div className={styles.divider} />
      <Button
        className={styles.invite}
        aria-expanded={inviteOpen}
        aria-controls="invite-help"
        onClick={() => setInviteOpen(!inviteOpen)}
      >
        <Ticket size={19} aria-hidden />
        ได้รับคำเชิญแล้ว
        <ArrowRight size={17} aria-hidden />
      </Button>
      {inviteOpen && (
        <div id="invite-help" className={styles.help}>
          <p>
            เปิดลิงก์คำเชิญที่ทีม Labs D ส่งให้ เพื่อตั้งชื่อผู้ใช้และรหัสผ่านของคุณ
            หากลิงก์หมดอายุหรือหาไม่พบ ให้ขอคำเชิญใหม่จากผู้ดูแลที่ประสานงานกับคุณ
          </p>
        </div>
      )}
      <Text variant="caption" tone="muted" className={styles.support}>
        ยังไม่มีคำเชิญ หรือมีปัญหาการเข้าถึง
        <br />
        <strong>ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณ</strong>
      </Text>
    </>
  );
}
