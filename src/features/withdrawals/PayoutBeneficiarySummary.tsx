import { useId, useState, type CSSProperties } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import {
  useBeneficiaryAccountNumber,
  useBeneficiaryRevealIdentityKey,
} from './BeneficiaryAccountRevealContext';
import type { PayoutBeneficiaryValue } from '@/contracts/withdrawal-journey';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import styles from './withdrawals.module.css';

/** Reuse a recognized mask's separators only when every digit has a matching slot. */
function formatAccountNumber(full: string, mask: string): string {
  if (!/^\d+$/.test(full) || !/^[Xx*•●\d -]+$/.test(mask)) return full;
  const slots = mask.match(/[Xx*•●\d]/g);
  if (slots?.length !== full.length) return full;
  let digit = 0;
  return mask.replace(/[Xx*•●\d]/g, () => full[digit++]);
}

function AccountNumber({ masked, full }: { masked: string; full: string | null }) {
  const [revealed, setRevealed] = useState(false);
  const formatted = full ? formatAccountNumber(full, masked) : null;
  const slotStyle = full
    ? ({
        '--account-text-width': `${Math.max([...masked].length, [...(formatted ?? '')].length) + 1}ch`,
      } as CSSProperties)
    : undefined;
  return (
    <dd
      className={`${styles.beneficiaryAccount} ${full ? styles.beneficiaryAccountRevealable : ''}`}
      style={slotStyle}
    >
      <span>{revealed && formatted ? formatted : masked}</span>
      {full && (
        <Button
          icon
          className={styles.beneficiaryReveal}
          aria-label={revealed ? 'ซ่อนเลขบัญชี' : 'แสดงเลขบัญชี'}
          aria-pressed={revealed}
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </Button>
      )}
    </dd>
  );
}

/** The transport remains masked; an optional capability supplies revealable account data. */
export function PayoutBeneficiarySummary({ beneficiary }: { beneficiary: PayoutBeneficiaryValue }) {
  const headingId = useId();
  const accountNumber = useBeneficiaryAccountNumber(beneficiary);
  const revealIdentity = useBeneficiaryRevealIdentityKey();

  return (
    <section className={styles.beneficiary} aria-labelledby={headingId}>
      <Text as="h3" variant="label" id={headingId} className={styles.beneficiaryHeading}>
        บัญชีรับเงิน
      </Text>
      {beneficiary.state === 'known' ? (
        <dl className={styles.beneficiaryDetails}>
          <div>
            <dt>ชื่อผู้รับเงิน</dt>
            <dd>{beneficiary.displayName}</dd>
          </div>
          <div>
            <dt>ธนาคาร</dt>
            <dd>{beneficiary.bankName}</dd>
          </div>
          <div>
            <dt>เลขบัญชี</dt>
            <AccountNumber
              key={JSON.stringify([
                revealIdentity,
                beneficiary.version,
                beneficiary.displayName,
                beneficiary.bankName,
                beneficiary.maskedAccount,
                accountNumber,
              ])}
              masked={beneficiary.maskedAccount}
              full={accountNumber}
            />
          </div>
        </dl>
      ) : (
        <TextGroup>
          <Text as="p" variant="label">
            {beneficiary.state === 'missing'
              ? 'ยังไม่มีข้อมูลบัญชีรับเงิน'
              : 'ข้อมูลบัญชีรับเงินยังรอตรวจสอบ'}
          </Text>
          <ul className={styles.beneficiaryReasons}>
            {beneficiary.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
          <Text as="p" variant="caption" tone="muted">
            ต้องมีข้อมูลบัญชีรับเงินที่พร้อมใช้งานก่อนยืนยันคำขอถอน
          </Text>
        </TextGroup>
      )}
    </section>
  );
}
