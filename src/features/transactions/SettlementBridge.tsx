import type { DetailValue } from './model';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Money } from '@/shared/ui/Money';
import styles from './transactions.module.css';
export function SettlementBridge({
  statement: s,
}: {
  statement: DetailValue['data']['statement'];
}) {
  return (
    <Card title="จากรายได้สู่ยอดคงเหลือ">
      <dl className={styles.bridge}>
        {(
          [
            ['ยอดยกมา', s.opening],
            ['รายได้ยืนยันใหม่', s.newEarnings],
            ['รายการปรับปรุง', s.adjustments],
            ['หักยอดชำระภาระแล้ว', s.settled],
            ['ยอดคงเหลือ', s.closing],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <Money value={value} />
            </dd>
          </div>
        ))}
      </dl>
      <Text variant="caption" tone="muted">
        ยอดยกมา + รายได้ยืนยันใหม่ + รายการปรับปรุง − ยอดชำระภาระแล้ว = ยอดคงเหลือ
      </Text>
      {BigInt(s.closing.minor) < 0n && (
        <Text variant="caption">ยอดติดลบเป็นเครดิตยกไปตามใบสรุป ไม่ใช่ยอดเงินที่จะโอนให้คุณ</Text>
      )}
    </Card>
  );
}
