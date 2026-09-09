'use client';
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  StaffAccessSnapshot,
  IssuedInvitation,
  RevokedInvitation,
  IssuedReset,
  type StaffAccessSessionValue,
} from '@/contracts/staff-access';
import { credentialRequest } from '@/features/login/credential-client';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { AppShell } from '@/features/shell/AppShell';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { DataState } from '@/shared/ui/DataState';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { timestamp } from '@/shared/ui/format-date';
import { InvitationForm, ResetForm, capabilityLabels, type AccessDraft } from './AccessForms';
import { IssuedAccessLink, type IssuedLink } from './IssuedAccessLink';
import forms from '@/shared/ui/forms.module.css';
export function StaffAccessConsole({ session }: { session: StaffAccessSessionValue }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    change();
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return (
    <AppShell
      active={null}
      title="Partner access"
      accent="Labs D"
      subtitle="คำเชิญ สมาชิก และการช่วยเหลือบัญชี"
      notifications={null}
    >
      <div className={forms.actions}>
        <LinkButton href="/account">บัญชีของคุณ / ออกจากระบบ</LinkButton>
        <LinkButton href="/login?next=%2Fops%2Faccess">ยืนยันตัวตนเจ้าหน้าที่อีกครั้ง</LinkButton>
      </div>
      {visible ? (
        <IsolatedQueryProvider identity={['staff-access', session.userId, session.revision]}>
          <AccessContent session={session} />
        </IsolatedQueryProvider>
      ) : (
        <DataState state="loading" />
      )}
    </AppShell>
  );
}
function AccessContent({ session }: { session: StaffAccessSessionValue }) {
  const client = useQueryClient();
  const [selection, setSelection] = useState<{
    partnerId?: string;
    partnerCursor: string | null;
    memberCursor: string | null;
    inviteCursor: string | null;
  }>({ partnerCursor: null, memberCursor: null, inviteCursor: null });
  const [draft, setDraft] = useState<AccessDraft | null>(null),
    [link, setLink] = useState<IssuedLink | null>(null),
    [message, setMessage] = useState('');
  const clearLink = useCallback(() => setLink(null), []);
  const q = useQuery({
    queryKey: ['staff-access', session.userId, session.revision, selection],
    queryFn: async ({ signal }) => {
      const result = await credentialRequest(
        '/api/access/staff/access',
        { expectedRevision: session.revision, ...selection },
        StaffAccessSnapshot,
        signal,
      );
      if (result.session.userId !== session.userId || result.session.revision !== session.revision)
        throw new Error('Staff scope changed');
      if ((result.selected?.partner.id ?? undefined) !== selection.partnerId)
        throw new Error('Partner response mismatch');
      return result;
    },
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (q.error) {
      setDraft(null);
      setLink(null);
    }
  }, [q.error]);
  const data = q.data,
    selected = data?.selected;
  const choose = (partnerId: string) => {
    setDraft(null);
    setLink(null);
    setMessage('');
    setSelection((old) => ({ ...old, partnerId, memberCursor: null, inviteCursor: null }));
  };
  async function execute(signal: AbortSignal, idempotencyKey: string) {
    if (!draft || !selected) throw new Error('กรุณาเลือกพาร์ทเนอร์ใหม่');
    if (draft.action === 'invite') {
      const result = await credentialRequest(
        '/api/access/invitations/issue',
        { ...draft.input, idempotencyKey },
        IssuedInvitation,
        signal,
      );
      if (result.partnerId !== draft.input.partnerId)
        throw new Error('ผลคำเชิญไม่ตรงกับพาร์ทเนอร์ กรุณารีเฟรชข้อมูล');
      if (!signal.aborted && result.token)
        setLink({
          path: '/invite',
          token: result.token,
          recipient: draft.input.recipientName,
          expiresAt: draft.input.expiresAt,
        });
      return {
        message: result.token
          ? 'สร้างลิงก์คำเชิญแล้ว ยังไม่ได้ส่งให้ผู้รับ'
          : 'รายการนี้สร้างไว้แล้ว แต่ไม่สามารถแสดงลิงก์เดิมซ้ำได้ หากไม่ได้เก็บลิงก์ไว้ ให้ออกคำเชิญใหม่',
      };
    }
    if (draft.action === 'revoke') {
      await credentialRequest(
        '/api/access/invitations/revoke',
        { ...draft.input, idempotencyKey },
        RevokedInvitation,
        signal,
      );
      return { message: 'ยกเลิกลิงก์คำเชิญแล้ว' };
    }
    const result = await credentialRequest(
      '/api/access/passwords/issue',
      { ...draft.input, idempotencyKey },
      IssuedReset,
      signal,
    );
    if (!signal.aborted && result.token)
      setLink({
        path: '/reset-password',
        token: result.token,
        recipient: draft.recipient,
        expiresAt: result.expiresAt,
      });
    return {
      message: result.token
        ? 'สร้างลิงก์ตั้งรหัสใหม่แล้ว ยังไม่ได้ส่งให้ผู้รับ'
        : 'รายการนี้สร้างไว้แล้ว หากไม่มีลิงก์เดิม ให้ออกลิงก์ใหม่หลังตรวจสอบเจ้าของบัญชี',
    };
  }
  function review(value: AccessDraft) {
    setLink(null);
    setMessage('');
    setDraft(value);
  }
  return (
    <div className={forms.stack}>
      <div className={forms.actions}>
        <Button
          onClick={() => {
            setLink(null);
            setDraft(null);
            void q.refetch();
          }}
        >
          รีเฟรชข้อมูล
        </Button>
      </div>
      {q.isPending && <DataState state="loading" />}
      {q.error && (
        <>
          <DataState
            state="error"
            message="ตรวจสอบสิทธิ์หรือข้อมูลไม่สำเร็จ กรุณาโหลดหน้าใหม่หรือยืนยันตัวตนอีกครั้ง"
          />
          <Button onClick={() => window.location.reload()}>โหลดหน้าใหม่</Button>
        </>
      )}
      {data && !q.error && (
        <>
          {message && <Text role="status">{message}</Text>}
          {link && <IssuedAccessLink value={link} onClose={clearLink} />}
          <Card title="เลือกพาร์ทเนอร์">
            {data.partners.items.length === 0 && (
              <Text tone="muted">ยังไม่มีพาร์ทเนอร์ในรายการนี้</Text>
            )}
            <div className={forms.actions}>
              {data.partners.items.map((p) => (
                <Button
                  key={p.id}
                  variant={selection.partnerId === p.id ? 'primary' : 'secondary'}
                  onClick={() => choose(p.id)}
                >
                  {p.name}
                  {p.status === 'suspended' ? ' · ระงับใช้งาน' : ''}
                </Button>
              ))}
            </div>
            <PageControls
              next={data.partners.nextCursor}
              current={selection.partnerCursor}
              onChange={(partnerCursor) => {
                setLink(null);
                setDraft(null);
                setSelection({ partnerCursor, memberCursor: null, inviteCursor: null });
              }}
            />
          </Card>
          {selected && (
            <>
              <Card
                title={selected.partner.name}
                description="ดีลเสร็จแล้วจึงออกคำเชิญให้ผู้รับตั้งบัญชีเอง"
              >
                {selected.partner.status === 'active' ? (
                  <details>
                    <summary>สร้างคำเชิญใหม่</summary>
                    <div className={forms.stack}>
                      <InvitationForm
                        key={selected.partner.id}
                        partnerId={selected.partner.id}
                        onReview={review}
                      />
                    </div>
                  </details>
                ) : (
                  <Text>พาร์ทเนอร์ถูกระงับ จึงยังออกคำเชิญใหม่ไม่ได้</Text>
                )}
              </Card>
              <Card title="คำเชิญ">
                {!selected.invitations.items.length && (
                  <Text tone="muted">ยังไม่มีคำเชิญในรายการนี้</Text>
                )}
                {selected.invitations.items.map((invite) => (
                  <div className={forms.stack} key={invite.id}>
                    <Text variant="label">
                      {invite.recipientName ?? 'คำเชิญเดิม'} ·{' '}
                      {
                        {
                          pending: 'รอผู้รับตั้งบัญชี',
                          expired: 'หมดอายุ',
                          revoked: 'ยกเลิกแล้ว',
                          claimed: 'รับคำเชิญแล้ว',
                        }[invite.status]
                      }
                    </Text>
                    <Text variant="caption" tone="muted">
                      หมดอายุ {timestamp(invite.expiresAt)} · ผู้ติดต่อ{' '}
                      {invite.verifiedContactRef ?? 'ยังไม่มีอ้างอิง'}
                    </Text>
                    {selected.partner.status === 'active' && invite.status !== 'claimed' && (
                      <>
                        {invite.status === 'pending' && (
                          <Button
                            onClick={() =>
                              review({
                                action: 'revoke',
                                input: { partnerId: selected.partner.id, inviteId: invite.id },
                                recipient: invite.recipientName ?? 'ผู้รับคำเชิญ',
                              })
                            }
                          >
                            ยกเลิกคำเชิญ
                          </Button>
                        )}
                        {invite.recipientName && invite.verifiedContactRef && (
                          <details>
                            <summary>ออกลิงก์ใหม่ให้ผู้รับนี้</summary>
                            <div className={forms.stack}>
                              <InvitationForm
                                partnerId={selected.partner.id}
                                previous={invite}
                                onReview={review}
                              />
                            </div>
                          </details>
                        )}
                      </>
                    )}
                  </div>
                ))}
                <PageControls
                  next={selected.invitations.nextCursor}
                  current={selection.inviteCursor}
                  onChange={(inviteCursor) => {
                    setLink(null);
                    setDraft(null);
                    setSelection((old) => ({ ...old, inviteCursor }));
                  }}
                />
              </Card>
              <Card title="สมาชิกและการช่วยเหลือบัญชี">
                {!selected.members.items.length && (
                  <Text tone="muted">ยังไม่มีสมาชิกในรายการนี้</Text>
                )}
                <div className={forms.stack}>
                  {selected.members.items.map((member) => (
                    <ResetForm
                      key={`${member.id}:${member.revision}`}
                      partnerId={selected.partner.id}
                      member={member}
                      onReview={review}
                    />
                  ))}
                </div>
                <PageControls
                  next={selected.members.nextCursor}
                  current={selection.memberCursor}
                  onChange={(memberCursor) => {
                    setLink(null);
                    setDraft(null);
                    setSelection((old) => ({ ...old, memberCursor }));
                  }}
                />
              </Card>
            </>
          )}
          {draft && selected && (
            <ConfirmAction
              title={
                draft.action === 'invite'
                  ? 'ตรวจคำเชิญ'
                  : draft.action === 'reset'
                    ? 'ตรวจลิงก์ตั้งรหัสใหม่'
                    : 'ตรวจการยกเลิกคำเชิญ'
              }
              onClose={() => setDraft(null)}
              onConfirm={execute}
              onComplete={(text) => {
                setMessage(text);
                setDraft(null);
                void client.invalidateQueries({
                  queryKey: ['staff-access', session.userId, session.revision],
                });
              }}
            >
              <Text>พาร์ทเนอร์: {selected.partner.name}</Text>
              <Text>
                ผู้รับ: {draft.action === 'invite' ? draft.input.recipientName : draft.recipient}
              </Text>
              {draft.action === 'invite' && (
                <>
                  <Text>ช่องทางอ้างอิง: {draft.input.verifiedContactRef}</Text>
                  <Text>
                    สิทธิ์: {draft.input.capabilities.map((c) => capabilityLabels[c]).join(' · ')}
                  </Text>
                  <Text>หมดอายุ {timestamp(draft.input.expiresAt)}</Text>
                  <Text>ลิงก์ใหม่จะยกเลิกลิงก์ที่ยังไม่ได้ใช้ของผู้ติดต่อเดียวกัน</Text>
                </>
              )}
              {draft.action === 'reset' && (
                <>
                  <Text>บัญชี: {draft.input.userId}</Text>
                  <Text>อ้างอิงช่องทางเดิม: {draft.input.verifiedContactRef}</Text>
                  <Text>หลักฐานตรวจสอบครั้งนี้: {draft.input.verificationEvidenceRef}</Text>
                  <Text>
                    ลิงก์ใหม่ใช้แทนลิงก์ตั้งรหัสเดิม
                    เมื่อผู้รับเปลี่ยนรหัสสำเร็จจะออกจากระบบทุกอุปกรณ์
                  </Text>
                </>
              )}
              <Text tone="muted">การยืนยันไม่ส่งข้อความอัตโนมัติ</Text>
              <LinkButton href="/login?next=%2Fops%2Faccess">
                หากระบบขอให้ยืนยันตัวตน ให้เข้าสู่ระบบอีกครั้ง
              </LinkButton>
            </ConfirmAction>
          )}
        </>
      )}
    </div>
  );
}
function PageControls({
  next,
  current,
  onChange,
}: {
  next: string | null;
  current: string | null;
  onChange: (cursor: string | null) => void;
}) {
  if (!next && !current) return null;
  return (
    <div className={forms.actions}>
      {current && <Button onClick={() => onChange(null)}>กลับรายการแรก</Button>}
      {next && <Button onClick={() => onChange(next)}>ดูรายการถัดไป</Button>}
    </div>
  );
}
