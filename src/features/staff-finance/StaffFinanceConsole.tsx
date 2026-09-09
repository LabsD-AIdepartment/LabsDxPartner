'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StaffAccessSessionValue } from '@/contracts/staff-access';
import type { FinancePeriodValue } from '@/contracts/staff-finance';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { StaffShell } from '@/features/operations/StaffShell';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Money } from '@/shared/ui/Money';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Field } from '@/shared/ui/Field';
import { DataState } from '@/shared/ui/DataState';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import { loadFinance, publishFinance } from './http';
import forms from '@/shared/ui/forms.module.css';
const states = {
  ready: 'พร้อมเผยแพร่',
  waiting: 'รอข้อมูล',
  blocked: 'ต้องตรวจสอบ',
  published: 'เผยแพร่แล้ว',
};
export function StaffFinanceConsole({ session }: { session: StaffAccessSessionValue }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    change();
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return (
    <StaffShell view="periods" routes={{ partners: '/ops/access', periods: '/ops/periods' }}>
      <div className={forms.actions}>
        <LinkButton href="/account">บัญชีของคุณ / ออกจากระบบ</LinkButton>
        <LinkButton href="/login?next=%2Fops%2Fperiods">ยืนยันตัวตนเจ้าหน้าที่อีกครั้ง</LinkButton>
      </div>
      {visible ? (
        <IsolatedQueryProvider identity={['staff-finance', session.userId, session.revision]}>
          <Periods session={session} />
        </IsolatedQueryProvider>
      ) : (
        <DataState state="loading" />
      )}
    </StaffShell>
  );
}
function Periods({ session }: { session: StaffAccessSessionValue }) {
  const [selection, setSelection] = useState<Parameters<typeof loadFinance>[1]>({});
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<{ period: FinancePeriodValue; scheduledAt: string } | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['staff-finance', session.userId, session.revision, selection],
    queryFn: ({ signal }) => loadFinance(session, selection, signal),
    refetchInterval: draft ? false : 30_000,
  });
  const data = query.data;
  useEffect(() => {
    if (query.error) setDraft(null);
  }, [query.error]);
  function select(value: Parameters<typeof loadFinance>[1]) {
    setDraft(null);
    setMessage('');
    setSelection(value);
  }
  return (
    <div className={forms.stack}>
      <form
        className={forms.actions}
        onSubmit={(event) => {
          event.preventDefault();
          select({ q: search.trim() });
        }}
      >
        <Field
          label="ค้นหาพาร์ทเนอร์"
          value={search}
          maxLength={160}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button type="submit">ค้นหา</Button>
        <Button
          onClick={() => {
            setDraft(null);
            void query.refetch();
          }}
        >
          รีเฟรชข้อมูล
        </Button>
      </form>
      {selection.scopeId && (
        <Button onClick={() => select({ q: search.trim() })}>กลับรายการงวด</Button>
      )}
      {query.isPending && <DataState state="loading" />}
      {query.error && (
        <DataState
          state="error"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      )}
      {data && !query.error && (
        <>
          {message && <Text role="status">{message}</Text>}
          <Text variant="caption" tone="muted">
            ข้อมูล ณ {timestamp(data.asOf)}
          </Text>
          {!data.periods.items.length && (
            <DataState state="empty" message="ยังไม่มีงวดที่ตรงกับรายการนี้" />
          )}
          {data.periods.items.map((period) => (
            <PeriodCard
              key={period.id + ':' + period.generationId}
              period={period}
              detail={!!selection.scopeId}
              onOpen={() => select({ partnerId: period.partnerId, scopeId: period.id })}
              onReview={(scheduledAt) => setDraft({ period, scheduledAt })}
            />
          ))}
          {data.lines && (
            <Card title="รายการรายได้และรายการตัดออก">
              {!data.lines.items.length && <Text tone="muted">ยังไม่มีรายการในข้อมูลชุดนี้</Text>}
              <div className={forms.stack}>
                {data.lines.items.map((line) => (
                  <div key={line.id}>
                    <Text variant="label">
                      {line.reference} ·{' '}
                      {line.kind === 'excluded'
                        ? 'ตัดออก'
                        : line.kind === 'commission'
                          ? 'คอมมิชชัน'
                          : line.kind === 'fixed-fee'
                            ? 'ค่าจ้างคงที่'
                            : line.kind === 'bonus'
                              ? 'โบนัส'
                              : 'ปรับปรุง'}
                    </Text>
                    {line.amount && <Money value={line.amount} />}
                    <Text variant="caption">
                      {dateLabel(line.earnedAt)} · ต้นทาง {line.sourceId} · หลักฐาน{' '}
                      {line.evidenceRef}
                    </Text>
                    {line.base && (
                      <Text variant="caption">
                        ฐาน <Money value={line.base} /> · อัตรา {(line.ratePpm ?? 0) / 10000}%
                      </Text>
                    )}
                    {line.agreementVersion && (
                      <Text variant="caption">
                        ข้อตกลง {line.agreementVersion} ·{' '}
                        {line.contentId ?? 'รายได้ของพาร์ทเนอร์ ไม่ระบุคลิป'}
                      </Text>
                    )}
                    {line.reasonRef && <Text variant="caption">เหตุผล {line.reasonRef}</Text>}
                  </div>
                ))}
              </div>
              <div className={forms.actions}>
                {selection.lineCursor && (
                  <Button onClick={() => select({ ...selection, lineCursor: undefined })}>
                    รายการแรก
                  </Button>
                )}
                {data.lines.nextCursor && (
                  <Button
                    onClick={() =>
                      select({
                        ...selection,
                        generationId: data.periods.items[0].generationId!,
                        lineCursor: data.lines!.nextCursor!,
                      })
                    }
                  >
                    รายการถัดไป
                  </Button>
                )}
              </div>
            </Card>
          )}
          {data.periods.nextCursor && (
            <Button onClick={() => select({ ...selection, cursor: data.periods.nextCursor! })}>
              งวดก่อนหน้า
            </Button>
          )}
          {selection.cursor && (
            <Button onClick={() => select({ q: search.trim() })}>กลับงวดล่าสุด</Button>
          )}
          {draft && (
            <ConfirmAction
              key={draft.period.id + ':' + draft.period.generationId + ':' + draft.scheduledAt}
              title="ตรวจใบสรุปก่อนเผยแพร่"
              onClose={() => setDraft(null)}
              onConfirm={async (signal, idempotencyKey) => {
                if (!draft.period.generationId || !draft.period.approvalId)
                  throw new Error('ยังไม่มีข้อมูลที่พร้อมเผยแพร่');
                await publishFinance(
                  {
                    expectedStaffRevision: session.revision,
                    partnerId: draft.period.partnerId,
                    generationId: draft.period.generationId,
                    approvalId: draft.period.approvalId,
                    scheduledAt: draft.scheduledAt,
                    idempotencyKey,
                  },
                  signal,
                );
                return { message: 'เผยแพร่ใบสรุปรายได้แล้ว พาร์ทเนอร์ตรวจสอบได้ในระบบ' };
              }}
              onComplete={(value) => {
                setMessage(value);
                setDraft(null);
                void query.refetch();
              }}
            >
              <Text variant="label">{draft.period.partnerName}</Text>
              <Text>
                {dateLabel(draft.period.period.from)} – ก่อน{' '}
                {dateLabel(draft.period.period.toExclusive)}
              </Text>
              {draft.period.amount && (
                <Text>
                  ยอดที่จะเผยแพร่ <Money value={draft.period.amount} />
                </Text>
              )}
              <Text>
                รวม {draft.period.includedCount} รายการ · ตัดออก {draft.period.excludedCount} รายการ
              </Text>
              <Text>กำหนดจ่าย {dateLabel(draft.scheduledAt)}</Text>
              <Text variant="caption">อ้างอิงการตรวจ {draft.period.reviewId}</Text>
              <Text variant="caption" tone="muted">
                ใบสรุปที่เผยแพร่แล้วเก็บเป็นประวัติ การแก้ไขภายหลังต้องเป็นรายการปรับปรุง
              </Text>
              <LinkButton href="/login?next=%2Fops%2Fperiods">
                ยืนยันตัวตนเจ้าหน้าที่อีกครั้ง
              </LinkButton>
            </ConfirmAction>
          )}
        </>
      )}
    </div>
  );
}
function PeriodCard({
  period,
  detail,
  onOpen,
  onReview,
}: {
  period: FinancePeriodValue;
  detail: boolean;
  onOpen: () => void;
  onReview: (scheduledAt: string) => void;
}) {
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  return (
    <Card
      title={period.partnerName}
      description={`${dateLabel(period.period.from)} – ก่อน ${dateLabel(period.period.toExclusive)}`}
    >
      <Text variant="label">{states[period.state]}</Text>
      <Text>
        {period.state === 'published' ? 'รายได้ยืนยัน' : 'ยอดจากข้อมูลที่กระทบแล้ว'}{' '}
        {period.amount ? <Money value={period.amount} /> : '—'}
      </Text>
      {period.includedCount !== null && (
        <Text variant="caption">
          รวม {period.includedCount} รายการ · ตัดออก {period.excludedCount} รายการ
        </Text>
      )}
      {period.closing && (
        <Text>
          ยอดคงเหลือ <Money value={period.closing} />
        </Text>
      )}
      {period.settled && (
        <Text variant="caption">
          ชำระภาระแล้ว <Money value={period.settled} />
        </Text>
      )}
      {period.scheduledAt && <Text>กำหนดจ่าย {dateLabel(period.scheduledAt)}</Text>}
      {period.issues.map((text) => (
        <Text key={text} tone="muted">
          {text}
        </Text>
      ))}
      {!detail ? (
        <Button onClick={onOpen}>ดูรายการและหลักฐาน</Button>
      ) : (
        <>
          <Text variant="caption">ข้อมูลถึง {timestamp(period.dataThrough)}</Text>
          <Text variant="caption">อ้างอิงการตรวจ {period.reviewId ?? 'ยังไม่มี'}</Text>
          <details>
            <summary>เลขอ้างอิงข้อมูล</summary>
            <Text variant="caption">
              ชุดข้อมูล {period.generationId ?? 'ยังไม่มี'} · ใบสรุป{' '}
              {period.statementId ?? 'ยังไม่เผยแพร่'}
            </Text>
          </details>
          {period.state === 'ready' && (
            <form
              className={forms.actions}
              onSubmit={(event) => {
                event.preventDefault();
                setError('');
                const scheduledDate = new Date(date + 'T12:00:00+07:00');
                if (!Number.isFinite(scheduledDate.getTime())) {
                  setError('กรุณาเลือกวันที่กำหนดจ่าย');
                  return;
                }
                const scheduledAt = scheduledDate.toISOString();
                if (Date.parse(scheduledAt) < Date.parse(period.period.toExclusive)) {
                  setError('กำหนดจ่ายต้องไม่ก่อนสิ้นงวด');
                  return;
                }
                onReview(scheduledAt);
              }}
            >
              <Field
                label="กำหนดจ่าย"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <Button type="submit">ตรวจการเผยแพร่</Button>
              {error && <Text role="alert">{error}</Text>}
            </form>
          )}
        </>
      )}
    </Card>
  );
}
