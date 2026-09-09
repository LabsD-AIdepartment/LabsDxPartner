import { useState } from 'react';
import type { OpsValue, DraftCommand } from './model';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Field';
import { dateLabel } from '@/shared/ui/format-date';
import styles from '@/shared/ui/forms.module.css';
export function PartnerEditor({
  partner,
  agreements,
  canManage,
  onReview,
}: {
  partner: OpsValue['partners']['items'][number];
  agreements: OpsValue['agreements'];
  canManage: boolean;
  onReview: (draft: DraftCommand, label: string) => void;
}) {
  const [contact, setContact] = useState(partner.verifiedContactRef ?? ''),
    [terms, setTerms] = useState(partner.agreementVersion ?? ''),
    [content, setContent] = useState(partner.contentRefs.join(', ')),
    [skus, setSkus] = useState(partner.skuRefs.join(', '));
  const [expires, setExpires] = useState('');
  const refs = (s: string) =>
    s
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <Card
      title={partner.name}
      description={`${partner.id} · ${{ active: 'เปิดใช้งาน', pending: 'รอตรวจสอบตัวตน', suspended: 'ระงับใช้งาน' }[partner.membership]}`}
    >
      <Text variant="caption">
        ข้อตกลง {partner.agreementVersion ?? 'ยังไม่ผูก'} · คลิป {partner.contentRefs.length} · SKU{' '}
        {partner.skuRefs.length}
      </Text>
      {canManage && (
        <div className={styles.stack}>
          <details>
            <summary>คำเชิญและสมาชิก</summary>
            <div className={styles.stack}>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  onReview(
                    {
                      action: 'invite',
                      partnerId: partner.id,
                      expiresAt: new Date(expires + 'T23:59:59+07:00').toISOString(),
                    },
                    'สร้างคำเชิญ',
                  );
                }}
              >
                <Field
                  label="คำเชิญหมดอายุวันที่"
                  type="date"
                  required
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
                <Button type="submit">ตรวจคำเชิญ</Button>
              </form>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  onReview(
                    {
                      action: 'membership',
                      partnerId: partner.id,
                      status: partner.membership === 'active' ? 'suspended' : 'active',
                      verifiedContactRef: contact.trim(),
                    },
                    partner.membership === 'active' ? 'ระงับสมาชิก' : 'เปิดใช้งานสมาชิก',
                  );
                }}
              >
                <Field
                  label="อ้างอิงการตรวจสอบตัวตน"
                  required
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  hint="ต้องตรวจผ่านช่องทางที่รู้จักแล้ว การมีลิงก์คำเชิญอย่างเดียวไม่ให้สิทธิ์"
                />
                <Button type="submit">
                  {partner.membership === 'active' ? 'ตรวจการระงับสมาชิก' : 'ตรวจการเปิดใช้งาน'}
                </Button>
              </form>
            </div>
          </details>
          <details>
            <summary>ผูกข้อตกลงและแหล่งรายได้</summary>
            <form
              className={styles.stack}
              onSubmit={(e) => {
                e.preventDefault();
                onReview(
                  {
                    action: 'terms',
                    partnerId: partner.id,
                    agreementVersion: terms,
                    contentRefs: refs(content),
                    skuRefs: refs(skus),
                  },
                  'ผูกข้อตกลงและรายการอ้างอิง',
                );
              }}
            >
              <label className={styles.field}>
                เวอร์ชันข้อตกลง
                <select required value={terms} onChange={(e) => setTerms(e.target.value)}>
                  <option value="">เลือกข้อตกลงที่ยืนยันแล้ว</option>
                  {agreements
                    .filter((a) => a.partnerId === partner.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id} · {dateLabel(a.effective.from)} – ก่อน{' '}
                        {dateLabel(a.effective.toExclusive)}
                      </option>
                    ))}
                </select>
              </label>
              <Field
                label="รหัสคลิปที่ผูก"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                hint="คั่นแต่ละรหัสด้วยเครื่องหมาย ,"
              />
              <Field
                label="รหัส SKU ที่ผูก"
                value={skus}
                onChange={(e) => setSkus(e.target.value)}
              />
              <Button type="submit">ตรวจการผูกข้อมูล</Button>
            </form>
          </details>
        </div>
      )}
    </Card>
  );
}
