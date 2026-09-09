import type { DraftCommand, OpsValue } from './model';
import { capabilityLabels } from '@/shared/access/CapabilityPicker';
import { Text } from '@/shared/ui/Text';
import { Money } from '@/shared/ui/Money';
import { timestamp, dateLabel } from '@/shared/ui/format-date';
import styles from './operations.module.css';
export function ReviewCommand({ command: c, value }: { command: DraftCommand; value: OpsValue }) {
  const partner = 'partnerId' in c ? value.partners.items.find((p) => p.id === c.partnerId) : null;
  const period =
    c.action === 'publish'
      ? value.periods.items.find((p) => p.id === c.periodId)
      : c.action === 'payment'
        ? value.periods.items.find((p) => p.statement?.id === c.statementId)
        : null;
  return (
    <div className={styles.review}>
      <Text>ตรวจรายละเอียดต่อไปนี้ก่อนยืนยัน</Text>
      <dl className={styles.facts}>
        {partner && (
          <div>
            <dt>พาร์ทเนอร์</dt>
            <dd>
              {partner.name} · {partner.id}
            </dd>
          </div>
        )}
        {period && (
          <>
            <div>
              <dt>งวด</dt>
              <dd>
                {dateLabel(period.period.from)} – ก่อน {dateLabel(period.period.toExclusive)}
              </dd>
            </div>
            <div>
              <dt>รายได้ยืนยัน</dt>
              <dd>
                <Money value={period.confirmed} />
              </dd>
            </div>
            <div>
              <dt>หลักฐานกระทบยอด</dt>
              <dd>{period.evidenceRef}</dd>
            </div>
          </>
        )}
        {c.action === 'membership' && (
          <>
            <div>
              <dt>สมาชิกที่จะเปลี่ยนสิทธิ์</dt>
              <dd>
                {partner?.members.find((m) => m.userId === c.userId)?.displayName} · {c.userId}
              </dd>
            </div>
            <div>
              <dt>สถานะใหม่</dt>
              <dd>{c.status === 'active' ? 'เปิดใช้งาน' : 'ระงับใช้งาน'}</dd>
            </div>
            <div>
              <dt>ช่องทางที่ตรวจสอบแล้ว</dt>
              <dd>{c.verifiedContactRef}</dd>
            </div>
          </>
        )}
        {c.action === 'membership' && (
          <div>
            <dt>ข้อมูลที่ให้ดู</dt>
            <dd>{c.capabilities.map((key) => capabilityLabels[key]).join(' · ') || 'ไม่มี'}</dd>
          </div>
        )}
        {c.action === 'terms' && (
          <>
            <div>
              <dt>เวอร์ชันข้อตกลง</dt>
              <dd>{c.agreementVersion}</dd>
            </div>
            <div>
              <dt>รหัสคลิป</dt>
              <dd>{c.contentRefs.join(', ') || 'ไม่มี'}</dd>
            </div>
            <div>
              <dt>รหัส SKU</dt>
              <dd>{c.skuRefs.join(', ') || 'ไม่มี'}</dd>
            </div>
          </>
        )}
        {c.action === 'import' && (
          <>
            <div>
              <dt>แหล่งข้อมูล</dt>
              <dd>{c.source}</dd>
            </div>
            <div>
              <dt>หลักฐาน</dt>
              <dd>{c.evidenceRef}</dd>
            </div>
          </>
        )}
        {c.action === 'publish' && (
          <>
            <div>
              <dt>Generation</dt>
              <dd>{c.generation}</dd>
            </div>
            <div>
              <dt>ผลของการยืนยัน</dt>
              <dd>เผยแพร่ใบสรุปงวดนี้ให้พาร์ทเนอร์ตรวจสอบ</dd>
            </div>
          </>
        )}
        {c.action === 'payment' && (
          <>
            <div>
              <dt>ใบสรุป</dt>
              <dd>{c.statementId}</dd>
            </div>
            <div>
              <dt>เงินโอน</dt>
              <dd>
                <Money value={c.cash} />
              </dd>
            </div>
            <div>
              <dt>ภาษีหัก ณ ที่จ่าย</dt>
              <dd>
                <Money value={c.withholding} />
              </dd>
            </div>
            <div>
              <dt>วิธีอื่น</dt>
              <dd>
                <Money value={c.other} />
              </dd>
            </div>
            <div>
              <dt>จ่ายจริง</dt>
              <dd>{timestamp(c.paidAt)}</dd>
            </div>
            <div>
              <dt>เลขอ้างอิง</dt>
              <dd>{c.reference}</dd>
            </div>
            <div>
              <dt>หลักฐานการชำระ</dt>
              <dd>{c.evidenceRef}</dd>
            </div>
          </>
        )}
      </dl>
      <Text variant="caption" tone="muted">
        หากสิทธิ์หรือข้อมูลเปลี่ยน ระบบต้องตรวจใหม่ก่อนทำรายการ
      </Text>
    </div>
  );
}
