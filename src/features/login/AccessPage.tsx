import { Clock3, ShieldAlert, CircleAlert, Ticket, LogIn } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { accessCopy, loginHref, type AccessReason } from './access';
import styles from './login.module.css';
export function AccessPage({
  reason,
  next,
  onRetry,
}: {
  reason: AccessReason;
  next: string;
  onRetry?: () => void;
}) {
  const copy = accessCopy[reason];
  const Icon =
    reason === 'pending'
      ? Clock3
      : reason === 'suspended'
        ? ShieldAlert
        : reason.startsWith('invite')
          ? Ticket
          : CircleAlert;
  return (
    <div className={styles.access}>
      <div className={styles.welcomeIcon}>
        <Icon size={28} aria-hidden />
      </div>
      <h2>{copy.title}</h2>
      <p className={styles.description}>{copy.description}</p>
      {onRetry ? (
        <Button variant="primary" onClick={onRetry}>
          {copy.action}
          <LogIn size={18} aria-hidden />
        </Button>
      ) : (
        <LinkButton variant="primary" href={loginHref(next)}>
          {copy.action}
          <LogIn size={18} aria-hidden />
        </LinkButton>
      )}
      <div className={styles.divider} />
      <p className={styles.support}>
        ต้องการความช่วยเหลือ
        <br />
        <strong>ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณ</strong>
      </p>
    </div>
  );
}
