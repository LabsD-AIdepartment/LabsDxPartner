'use client';
import { useEffect, useRef, useState } from 'react';
import { AccountContact, type ContactSnapshotValue } from '@/contracts/account-contact';
import { scopeKey, type QueryScope } from '@/shared/query/keys';
import { Card } from '@/shared/ui/Card';
import { Field } from '@/shared/ui/Field';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { DataState } from '@/shared/ui/DataState';
import { ContactRequestError, scopedContact, type ContactTransport } from './contact-http';
import forms from '@/shared/ui/forms.module.css';
import styles from './account-contacts.module.css';

type Props = { scope: QueryScope; transport: ContactTransport };
export function AccountContacts(props: Props) {
  return <ContactForm key={JSON.stringify(scopeKey(props.scope))} {...props} />;
}
function ContactForm({ scope, transport }: Props) {
  const [snapshot, setSnapshot] = useState<ContactSnapshotValue | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState('');
  const [needsReload, setNeedsReload] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; phone?: string }>({});
  const [attempt, setAttempt] = useState(0);
  const active = useRef<AbortController | null>(null);
  function accept(value: ContactSnapshotValue) {
    const checked = scopedContact(value, scope);
    setSnapshot(checked);
    setEmail(checked.contact.email ?? '');
    setPhone(checked.contact.phone ?? '');
  }
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setLoadError(false);
    setMessage('');
    setErrors({});
    void transport
      .read(scope, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          accept(value);
          setNeedsReload(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      active.current?.abort();
    };
    // Parent wrapper remounts on any identity/permission change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, transport]);
  const dirty =
    snapshot &&
    (email !== (snapshot.contact.email ?? '') || phone !== (snapshot.contact.phone ?? ''));
  const saveDisabled = !dirty || saving || needsReload;
  return (
    <Card title="ข้อมูลติดต่อ" description="อีเมลและเบอร์โทรสำหรับติดต่อเรื่องบัญชีพาร์ตเนอร์">
      <div className={forms.stack}>
        <Text variant="caption" tone="muted" leading="reading">
          สำหรับแจ้งค่าคอมมิชชันพร้อมถอน รายงานการถอนเงิน รวมถึงการกู้คืนบัญชีและคำเชิญพาร์ตเนอร์
        </Text>
        {loading ? (
          <DataState state="loading" />
        ) : loadError ? (
          <DataState
            state="error"
            message="โหลดข้อมูลติดต่อไม่สำเร็จ"
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : (
          <form
            className={forms.form}
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              if (!snapshot || saving || needsReload) return;
              const parsed = AccountContact.safeParse({
                email: email.trim() || null,
                phone: phone.trim() || null,
              });
              if (!parsed.success) {
                setErrors({
                  email: parsed.error.issues.some((issue) => issue.path[0] === 'email')
                    ? 'กรอกอีเมลให้ถูกต้อง เช่น name@example.com'
                    : undefined,
                  phone: parsed.error.issues.some((issue) => issue.path[0] === 'phone')
                    ? 'กรอกเบอร์โทร 8–15 หลัก เช่น 0812345678 หรือ +66812345678'
                    : undefined,
                });
                setMessage('');
                return;
              }
              setErrors({});
              setSaving(true);
              setMessage('');
              const controller = new AbortController();
              active.current = controller;
              try {
                const result = await transport.save(
                  scope,
                  snapshot.revision,
                  parsed.data,
                  controller.signal,
                );
                if (!controller.signal.aborted) {
                  accept(result);
                  setMessage('บันทึกข้อมูลติดต่อแล้ว');
                }
              } catch (error) {
                if (!controller.signal.aborted) {
                  setNeedsReload(true);
                  setMessage(
                    error instanceof ContactRequestError && error.status === 409
                      ? 'ข้อมูลมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง'
                      : 'ยังยืนยันการบันทึกไม่ได้ กรุณาโหลดข้อมูลล่าสุดเพื่อตรวจสอบ',
                  );
                }
              } finally {
                if (!controller.signal.aborted) setSaving(false);
              }
            }}
          >
            <div className={styles.fields}>
              <Field
                label="อีเมล"
                type="email"
                autoComplete="email"
                maxLength={200}
                value={email}
                placeholder="name@example.com"
                error={errors.email}
                disabled={saving || needsReload}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setMessage('');
                }}
              />
              <Field
                label="เบอร์โทรศัพท์"
                type="tel"
                autoComplete="tel"
                maxLength={40}
                value={phone}
                placeholder="0812345678"
                error={errors.phone}
                disabled={saving || needsReload}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setMessage('');
                }}
              />
            </div>
            <Text variant="caption" tone="muted" leading="reading">
              ข้อมูลที่บันทึกยังไม่ได้ยืนยันช่องทาง การแจ้งเตือนทาง SMS /
              อีเมลและการส่งลิงก์ยังไม่เปิดใช้งาน
            </Text>
            <div className={styles.actions}>
              <Button
                type="submit"
                variant={saveDisabled ? 'secondary' : 'primary'}
                disabled={saveDisabled}
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูลติดต่อ'}
              </Button>
              {needsReload && (
                <Button onClick={() => setAttempt((value) => value + 1)}>โหลดข้อมูลล่าสุด</Button>
              )}
              {message && (
                <Text variant="caption" role="status">
                  {message}
                </Text>
              )}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
