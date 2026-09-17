import type { WithdrawalGatewayStatusValue } from '@/contracts/withdrawal-journey';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import styles from './withdrawal-periods.module.css';

/** Static validated configuration only. No provider, credential or payment authority. */
export function WithdrawalGatewayCard({ gateway }: { gateway: WithdrawalGatewayStatusValue }) {
  return (
    <Card
      title="การเชื่อมต่อระบบโอนเงิน"
      aria-label="การเชื่อมต่อระบบโอนเงิน"
      className={styles.gateway}
    >
      <Text role="status">ยังไม่ได้เชื่อมต่อระบบโอนเงินจริง</Text>
      <Text variant="caption" tone="muted">
        หน้านี้แสดงสถานะการตั้งค่าเท่านั้น
      </Text>
      <ul className={styles.reasons} aria-label="เหตุผลที่ยังไม่ได้เชื่อมต่อ">
        {gateway.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </Card>
  );
}
