'use client';
import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { ActivationInviteRequest } from '@/contracts/invitations';
import { IssuePasswordReset } from '@/contracts/passwords';
import type { AccessMember, AccessInvitation } from '@/contracts/staff-access';
import { CapabilityPicker, type Capability } from '@/shared/access/CapabilityPicker';
export { capabilityLabels } from '@/shared/access/CapabilityPicker';
import type { MemberDraft } from '@/shared/access/MemberAccessForm';
import { Field } from '@/shared/ui/Field';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { Card } from '@/shared/ui/Card';
import forms from '@/shared/ui/forms.module.css';
export type InviteDraft = Omit<z.infer<typeof ActivationInviteRequest>, 'idempotencyKey'>;
export type ResetDraft = Omit<z.infer<typeof IssuePasswordReset>, 'idempotencyKey'>;
export type AccessDraft =
  | { action: 'membership'; input: MemberDraft; recipient: string }
  | { action: 'invite'; input: InviteDraft }
  | { action: 'reset'; input: ResetDraft; recipient: string }
  | { action: 'revoke'; input: { partnerId: string; inviteId: string }; recipient: string };
export function InvitationForm({
  partnerId,
  previous,
  onReview,
}: {
  partnerId: string;
  previous?: z.infer<typeof AccessInvitation>;
  onReview: (draft: AccessDraft) => void;
}) {
  const [name, setName] = useState(previous?.recipientName ?? ''),
    [contact, setContact] = useState(previous?.verifiedContactRef ?? '');
  const [days, setDays] = useState('3'),
    [checked, setChecked] = useState(false),
    [error, setError] = useState('');
  const [capabilities, setCapabilities] = useState<Capability[]>(
    previous?.capabilities ?? ['view_earnings', 'view_content', 'view_statements'],
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    const input = ActivationInviteRequest.safeParse({
      partnerId,
      recipientName: name,
      verifiedContactRef: contact.trim(),
      capabilities,
      expiresAt: new Date(Date.now() + Number(days) * 86400000).toISOString(),
      idempotencyKey: 'validation-only',
    });
    if (!input.success || !checked) {
      setError('กรอกผู้รับและอ้างอิงช่องทางติดต่อ เลือกสิทธิ์ และยืนยันว่าดีลเสร็จแล้ว');
      return;
    }
    const { idempotencyKey: _, ...draft } = input.data;
    onReview({ action: 'invite', input: draft });
  }
  return (
    <form onSubmit={submit} className={forms.form}>
      <Field
        label="ชื่อผู้รับคำเชิญ"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        required
      />
      <Field
        label="อ้างอิงช่องทางติดต่อที่ตรวจสอบแล้ว"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        required
        hint="ใช้รหัสอ้างอิงผู้ติดต่อหรือบันทึกดีลที่ตรวจสอบกลับได้"
      />
      <CapabilityPicker
        value={capabilities}
        onChange={setCapabilities}
        legend="ข้อมูลที่ผู้รับดูได้"
      />
      <label className={forms.field}>
        ลิงก์ใช้งานได้
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="1">1 วัน</option>
          <option value="3">3 วัน</option>
          <option value="7">7 วัน</option>
        </select>
      </label>
      <label className={forms.row}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        ดีลกับผู้รับเรียบร้อย และตรวจสอบช่องทางติดต่อแล้ว
      </label>
      {previous && (
        <Text tone="muted">
          ลิงก์ใหม่จะยกเลิกลิงก์ที่ยังไม่ได้ใช้ของผู้รับคนนี้
          กรุณาส่งลิงก์ใหม่ผ่านช่องทางที่ตรวจสอบแล้ว
        </Text>
      )}
      {error && <Text role="alert">{error}</Text>}
      <Button type="submit" variant="primary">
        ตรวจคำเชิญก่อนสร้างลิงก์
      </Button>
    </form>
  );
}
export function ResetForm({
  partnerId,
  member,
  onReview,
}: {
  partnerId: string;
  member: z.infer<typeof AccessMember>;
  onReview: (draft: AccessDraft) => void;
}) {
  const [evidence, setEvidence] = useState(''),
    [checked, setChecked] = useState(false),
    [error, setError] = useState('');
  return (
    <Card
      title={member.displayName}
      description={`ชื่อผู้ใช้ ${member.username ?? 'ยังไม่ตั้ง'} · ${member.status === 'active' ? 'เปิดใช้งาน' : 'ยังไม่เปิดใช้งาน'}`}
    >
      <Text variant="caption" tone="muted">
        บัญชีอ้างอิง {member.userId}
      </Text>
      <Text variant="caption">
        ช่องทางที่ตรวจสอบแล้ว: {member.verifiedContactRef ?? 'ยังไม่มีอ้างอิง'}
      </Text>
      {member.resetAllowed ? (
        <details>
          <summary>ช่วยตั้งรหัสผ่านใหม่</summary>
          <form
            className={forms.stack}
            onSubmit={(e) => {
              e.preventDefault();
              const input = IssuePasswordReset.safeParse({
                partnerId,
                userId: member.userId,
                expectedRevision: member.revision,
                verifiedContactRef: member.verifiedContactRef,
                verificationEvidenceRef: evidence.trim(),
                idempotencyKey: 'validation-only',
              });
              if (!input.success || !checked) {
                setError('กรอกหลักฐานและยืนยันตัวตนผ่านช่องทางเดิมก่อน');
                return;
              }
              const { idempotencyKey: _, ...draft } = input.data;
              onReview({ action: 'reset', input: draft, recipient: member.displayName });
            }}
          >
            <Field
              label="อ้างอิงหลักฐานการตรวจสอบครั้งนี้"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              required
            />
            <label className={forms.row}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              ตรวจสอบเจ้าของบัญชีผ่านช่องทางที่บันทึกไว้แล้ว
            </label>
            <Text tone="muted">
              เจ้าของบัญชีตั้งรหัสเอง ลิงก์หมดอายุใน 30 นาที
              และเมื่อเปลี่ยนสำเร็จจะออกจากระบบทุกอุปกรณ์
            </Text>
            {error && <Text role="alert">{error}</Text>}
            <Button type="submit">ตรวจการออกลิงก์ตั้งรหัสใหม่</Button>
          </form>
        </details>
      ) : (
        <Text tone="muted">
          บัญชีนี้ยังออกลิงก์ตั้งรหัสผ่านผ่านช่องทางนี้ไม่ได้ กรุณาตรวจสิทธิ์กับผู้ดูแล
        </Text>
      )}
    </Card>
  );
}
