'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { REVIEW_REFERENCE_PATTERN } from '@/contracts/review-reference';
import { ProfileReview, ProfilePublishReceipt } from '@/contracts/account-profile';
import { credentialRequest, CredentialError } from '@/features/login/credential-client';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { dateLabel } from '@/shared/ui/format-date';
import forms from '@/shared/ui/forms.module.css';
const errorMessage = (error: unknown) =>
  error instanceof CredentialError && error.code === 'FRESH_AUTH_REQUIRED'
    ? error.message
    : error instanceof CredentialError && error.code === 'CHANGED'
      ? 'ข้อตกลงหรือข้อมูลที่แสดงเปลี่ยนแล้ว กรุณาเปิดตรวจอีกครั้ง'
      : 'เปิดหรือเผยแพร่ข้อตกลงไม่สำเร็จ ตรวจรหัสอ้างอิงและสิทธิ์ของคุณแล้วลองอีกครั้ง';
/** Remount per partner so a reviewed source can never follow a different selection. */
export function StaffAccountProfile(props: { partnerId: string; partnerName: string }) {
  return <ProfileForm key={props.partnerId} {...props} />;
}
function ProfileForm({ partnerId, partnerName }: { partnerId: string; partnerName: string }) {
  const [reference, setReference] = useState(''),
    [review, setReview] = useState<z.infer<typeof ProfileReview> | null>(null);
  const [pending, setPending] = useState(false),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return (
    <Card title="ข้อตกลงที่แสดงให้พาร์ทเนอร์">
      <div className={forms.stack}>
        <Text tone="muted">ใช้ข้อตกลงที่ทีมเตรียมไว้หลังปิดดีล ตรวจรายละเอียดก่อนนำขึ้นแสดง</Text>
        <form
          className={forms.stack}
          onSubmit={async (event) => {
            event.preventDefault();
            active.current?.abort();
            const controller = new AbortController();
            active.current = controller;
            setReview(null);
            setMessage('');
            setPending(true);
            try {
              const result = await credentialRequest(
                '/api/v1/staff/account-profiles/inspect',
                { partnerId, reviewId: reference.trim() },
                ProfileReview,
                controller.signal,
              );
              if (
                result.partnerId !== partnerId ||
                result.profile.partnerId !== partnerId ||
                result.reviewId !== reference.trim()
              )
                throw new Error('Scope mismatch');
              if (!controller.signal.aborted) setReview(result);
            } catch (error) {
              if (!controller.signal.aborted) setMessage(errorMessage(error));
            } finally {
              if (!controller.signal.aborted) setPending(false);
            }
          }}
        >
          <label className={forms.field}>
            รหัสอ้างอิงข้อตกลง
            <input
              required
              pattern={REVIEW_REFERENCE_PATTERN}
              maxLength={128}
              value={reference}
              onChange={(event) => {
                active.current?.abort();
                setPending(false);
                setReference(event.target.value);
                setReview(null);
                setConfirm(false);
                setMessage('');
              }}
            />
          </label>
          <div className={forms.actions}>
            <Button type="submit" disabled={pending}>
              {pending ? 'กำลังเปิดข้อตกลง…' : 'เปิดตรวจข้อตกลง'}
            </Button>
          </div>
        </form>
        {message && <Text role="status">{message}</Text>}
        {review && (
          <div className={forms.stack}>
            <Text variant="label">{partnerName}</Text>
            <ProfileDetails review={review} />
            <Text tone="muted">
              เผยแพร่เพื่อแสดงในหน้าบัญชีเท่านั้น ยอดคอมมิชชันและการจ่ายยังอิงระบบการเงิน
            </Text>
            <div className={forms.actions}>
              <Button variant="primary" onClick={() => setConfirm(true)}>
                นำข้อตกลงขึ้นแสดง
              </Button>
            </div>
          </div>
        )}
        {confirm && review && (
          <ConfirmAction
            title="นำข้อตกลงขึ้นแสดง"
            onClose={() => setConfirm(false)}
            onConfirm={async (signal, idempotencyKey) => {
              try {
                const { profile: _profile, ...command } = review;
                const receipt = await credentialRequest(
                  '/api/v1/staff/account-profiles/publish',
                  { ...command, idempotencyKey },
                  ProfilePublishReceipt,
                  signal,
                );
                if (
                  receipt.partnerId !== partnerId ||
                  BigInt(receipt.revision) !== BigInt(review.expectedRevision) + 1n
                )
                  throw new Error('Receipt mismatch');
                return { message: 'นำข้อตกลงขึ้นแสดงในหน้าบัญชีพาร์ทเนอร์แล้ว' };
              } catch (error) {
                throw new Error(errorMessage(error));
              }
            }}
            onComplete={(text) => {
              setConfirm(false);
              setReview(null);
              setMessage(text);
            }}
          >
            <Text>{partnerName}</Text>
            <ProfileDetails review={review} />
            <Text>ข้อมูลนี้จะแทนข้อตกลงที่แสดงอยู่ในหน้าบัญชี</Text>
            <LinkButton href="/login?next=%2Fops%2Faccess">
              ยืนยันตัวตนอีกครั้งหากระบบร้องขอ
            </LinkButton>
          </ConfirmAction>
        )}
      </div>
    </Card>
  );
}
function ProfileDetails({ review }: { review: z.infer<typeof ProfileReview> }) {
  const { profile } = review;
  return (
    <div className={forms.stack}>
      <Text>{profile.termsSummary ?? 'ไม่มีสรุปเงื่อนไขในแหล่งข้อมูลนี้'}</Text>
      {profile.agreement ? (
        <>
          <Text>
            มีผล {dateLabel(profile.agreement.effective.from)} – ก่อน{' '}
            {dateLabel(profile.agreement.effective.toExclusive)}
          </Text>
          <Text>
            ข้อตกลง {profile.agreement.id} · อ้างอิง {profile.agreement.evidenceRef}
          </Text>
        </>
      ) : (
        <Text>ไม่มีข้อตกลง — การเผยแพร่จะล้างข้อตกลงที่แสดงอยู่</Text>
      )}
      <Text tone="muted">
        เวอร์ชันต้นทาง {profile.sourceRevision} · หลักฐาน {profile.evidenceRef}
      </Text>
      <Text>ช่องทางช่วยเหลือ: {profile.supportUrl ?? 'ใช้ช่องทางที่ประสานงานกันอยู่'}</Text>
    </div>
  );
}
