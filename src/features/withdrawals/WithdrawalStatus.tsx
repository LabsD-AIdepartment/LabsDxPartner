import type { RequestStatusValue } from '@/contracts/withdrawal-journey';
import { Text } from '@/shared/ui/Text';
import styles from './withdrawals.module.css';

export const withdrawalStatusLabels: Readonly<Record<RequestStatusValue, string>> = {
  requested: 'รอดำเนินการ',
  processing: 'กำลังดำเนินการโอน',
  paid: 'โอนเงินแล้ว',
  cancelled: 'คำขอถูกยกเลิกแล้ว',
  failed: 'คำขอไม่สำเร็จ',
  reconciling: 'ยังยืนยันผลการโอนไม่ได้',
};

/** A supplied request status, not a statement status or an action-eligibility decision. */
export function WithdrawalStatus({ status }: { status: RequestStatusValue }) {
  return (
    <Text as="span" variant="caption" className={styles.requestStatus}>
      {withdrawalStatusLabels[status]}
    </Text>
  );
}
