'use client';
import { useState } from 'react';
import { ArrowRight, Ticket, MailCheck } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { accessHref, type AccessReason } from './access';
import { Text } from '@/shared/ui/Text';
import styles from './login.module.css';
export function LoginPage({
  next,
  onPreview,
}: {
  next: string;
  onPreview?: (reason: AccessReason) => void;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <>
      <div className={styles.welcomeIcon}>
        <ArrowRight aria-hidden size={25} />
      </div>
      <h2>ยินดีต้อนรับ พาร์ทเนอร์</h2>
      <Text variant="caption" tone="muted" className={styles.description}>
        เข้าสู่ระบบด้วยบัญชีที่คุณใช้รับคำเชิญ
        <br />
        เพื่อดูผลงานและรายได้ของคุณ
      </Text>
      <div className={styles.providers} aria-label="เลือกบัญชีเข้าสู่ระบบ">
        {(['Google', 'LINE', 'Apple'] as const).map((provider) =>
          onPreview ? (
            <Button key={provider} className={styles.provider} onClick={() => onPreview('pending')}>
              <span aria-hidden className={styles.providerMark}>
                {provider === 'Google' ? 'G' : provider === 'LINE' ? 'L' : 'A'}
              </span>
              เข้าสู่ระบบด้วย {provider}
              <ArrowRight aria-hidden size={17} />
            </Button>
          ) : (
            <LinkButton
              key={provider}
              className={styles.provider}
              href={accessHref('provider-unavailable', next)}
            >
              <span aria-hidden className={styles.providerMark}>
                {provider === 'Google' ? 'G' : provider === 'LINE' ? 'L' : 'A'}
              </span>
              เข้าสู่ระบบด้วย {provider}
              <ArrowRight aria-hidden size={17} />
            </LinkButton>
          ),
        )}
      </div>
      <Text variant="caption" tone="muted" className={styles.availability} role="status">
        {onPreview
          ? 'ตัวอย่างการเข้าสู่ระบบ · ไม่เชื่อมบัญชีจริง'
          : 'กำลังเตรียมเปิดใช้งานการเชื่อมบัญชี'}
      </Text>
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
          <MailCheck size={22} aria-hidden />
          <p>
            เปิดลิงก์คำเชิญที่ทีม Labs D ส่งให้ แล้วเลือกบัญชีที่ต้องการใช้กับพาร์ทเนอร์
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
