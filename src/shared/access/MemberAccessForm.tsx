'use client';
import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { MembershipChange, type MembershipSummary } from '@/contracts/access';
import { CapabilityPicker } from './CapabilityPicker';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Field';
import { Text } from '@/shared/ui/Text';
import forms from '@/shared/ui/forms.module.css';
export type MemberDraft = Omit<z.infer<typeof MembershipChange>, 'idempotencyKey'>;
export function MemberAccessForm({
  partnerId,
  member,
  onReview,
}: {
  partnerId: string;
  member: z.infer<typeof MembershipSummary>;
  onReview: (draft: MemberDraft, label: string) => void;
}) {
  const [contact, setContact] = useState(member.verifiedContactRef ?? '');
  const [capabilities, setCapabilities] = useState(member.capabilities);
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'save';
    const status =
      action === 'suspend' ? 'suspended' : action === 'restore' ? 'active' : member.status;
    const parsed = MembershipChange.safeParse({
      partnerId,
      userId: member.userId,
      expectedRevision: member.revision,
      status,
      verifiedContactRef: contact.trim(),
      capabilities,
      idempotencyKey: 'validation-only',
    });
    if (!parsed.success) {
      setError(
        'กรอกอ้างอิงช่องทางที่ตรวจสอบแล้ว และเลือกข้อมูลที่ให้ดูอย่างน้อยหนึ่งรายการเมื่อเปิดใช้งาน',
      );
      return;
    }
    const { idempotencyKey: _, ...draft } = parsed.data;
    onReview(
      draft,
      action === 'suspend'
        ? 'ระงับสมาชิก'
        : action === 'restore'
          ? 'เปิดใช้งานสมาชิก'
          : 'ปรับข้อมูลและสิทธิ์สมาชิก',
    );
  }
  return (
    <form className={forms.stack} onSubmit={submit}>
      <Text variant="label">{member.displayName}</Text>
      <Text variant="caption" tone="muted">
        {
          {
            active: 'เปิดใช้งาน',
            suspended: 'ระงับใช้งาน',
            pending: 'บัญชีเดิมที่ยังไม่ได้ยืนยันการเข้าถึง',
          }[member.status]
        }{' '}
        · {member.userId}
      </Text>
      {member.status === 'pending' && (
        <Text tone="muted">
          คำเชิญแบบใหม่เปิดใช้งานให้ผู้รับหลังตั้งบัญชีสำเร็จโดยตรง สถานะนี้ใช้ตรวจบัญชีเดิมเท่านั้น
        </Text>
      )}
      <Field
        label="อ้างอิงช่องทางติดต่อที่ตรวจสอบแล้ว"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        required
        hint="ใช้ช่องทางที่ตกลงไว้กับเจ้าของบัญชี เมื่อแก้ไขต้องตรวจสอบผู้รับให้ตรงคน"
      />
      <CapabilityPicker value={capabilities} onChange={setCapabilities} />
      {error && <Text role="alert">{error}</Text>}
      <div className={forms.actions}>
        {member.status !== 'pending' && (
          <Button type="submit" name="memberAction" value="save">
            ตรวจการบันทึกสิทธิ์
          </Button>
        )}
        {member.status === 'active' ? (
          <Button type="submit" name="memberAction" value="suspend">
            ตรวจการระงับสมาชิก
          </Button>
        ) : (
          <Button type="submit" name="memberAction" value="restore">
            ตรวจการเปิดใช้งานสมาชิก
          </Button>
        )}
      </div>
    </form>
  );
}
