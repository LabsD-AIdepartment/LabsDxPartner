import { useState } from 'react';
import { moneyInput, type OpsValue, type DraftCommand } from './model';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Money } from '@/shared/ui/Money';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Field';
import { dateLabel } from '@/shared/ui/format-date';
import styles from '@/shared/ui/forms.module.css';
export function PeriodEditor({
  period,
  canPublish,
  canPay,
  onReview,
}: {
  period: OpsValue['periods']['items'][number];
  canPublish: boolean;
  canPay: boolean;
  onReview: (draft: DraftCommand, label: string) => void;
}) {
  const [cash, setCash] = useState(''),
    [tax, setTax] = useState('0'),
    [other, setOther] = useState('0'),
    [reference, setReference] = useState(''),
    [evidence, setEvidence] = useState(''),
    [paidAt, setPaidAt] = useState(''),
    [error, setError] = useState('');
  return (
    <Card
      title={period.partnerName}
      description={`${dateLabel(period.period.from)} – ก่อน ${dateLabel(period.period.toExclusive)} · ${period.id}`}
    >
      <Text variant="label">
        {
          {
            draft: 'ร่าง',
            'needs-review': 'ต้องตรวจสอบ',
            reconciled: 'กระทบยอดแล้ว',
            published: 'เผยแพร่แล้ว',
          }[period.status]
        }
      </Text>
      <Text>
        รายได้ยืนยัน <Money value={period.confirmed} />
      </Text>
      <Text variant="caption" tone="muted">
        Generation {period.generation} · ตัดออก {period.excludedCount} รายการ · รอตรวจ{' '}
        {period.unresolvedCount} รายการ · หลักฐาน {period.evidenceRef}
      </Text>
      {canPublish && period.status !== 'published' && (
        <Button
          disabled={period.status !== 'reconciled' || period.unresolvedCount > 0}
          onClick={() =>
            onReview(
              {
                action: 'publish',
                periodId: period.id,
                partnerId: period.partnerId,
                generation: period.generation,
                evidenceRef: period.evidenceRef,
              },
              'เผยแพร่รอบจ่าย',
            )
          }
        >
          ตรวจการเผยแพร่
        </Button>
      )}
      {period.statement && (
        <Text>
          ยอดคงเหลือ <Money value={period.statement.closing} />
        </Text>
      )}
      {canPay &&
        period.status === 'published' &&
        period.statement &&
        BigInt(period.statement.closing.minor) > 0n && (
          <details>
            <summary>บันทึกการชำระ</summary>
            <Text variant="caption" tone="muted">
              บันทึกเงินที่ชำระแล้วพร้อมหลักฐาน ระบบไม่ได้โอนเงินหรือออกเอกสารภาษี
            </Text>
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                try {
                  onReview(
                    {
                      action: 'payment',
                      partnerId: period.partnerId,
                      statementId: period.statement!.id,
                      reference: reference.trim(),
                      evidenceRef: evidence.trim(),
                      paidAt: new Date(paidAt + '+07:00').toISOString(),
                      cash: moneyInput(cash),
                      withholding: moneyInput(tax),
                      other: moneyInput(other),
                    },
                    'บันทึกการชำระ',
                  );
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'ข้อมูลไม่ถูกต้อง');
                }
              }}
            >
              <div className={styles.grid}>
                <Field
                  label="เงินโอน (บาท)"
                  inputMode="decimal"
                  required
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                />
                <Field
                  label="ภาษีหัก ณ ที่จ่าย (บาท)"
                  inputMode="decimal"
                  required
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
                <Field
                  label="ชำระด้วยวิธีอื่น (บาท)"
                  inputMode="decimal"
                  required
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                />
              </div>
              <Field
                label="จ่ายจริงวันที่และเวลา (ประเทศไทย)"
                type="datetime-local"
                required
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
              <Field
                label="เลขอ้างอิงการชำระ"
                required
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <Field
                label="อ้างอิงหลักฐานการชำระ"
                required
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
              {error && <Text role="alert">{error}</Text>}
              <Button type="submit">ตรวจรายการชำระ</Button>
            </form>
          </details>
        )}
    </Card>
  );
}
