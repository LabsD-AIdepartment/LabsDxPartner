'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Field } from '@/shared/ui/Field';
import { DataState } from '@/shared/ui/DataState';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { timestamp } from '@/shared/ui/format-date';
import {
  OpsError,
  loadOps,
  submitOps,
  type OpsScope,
  type OpsTransport,
  type OpsView,
  type DraftCommand,
} from './model';
import { PartnerEditor } from './PartnerEditor';
import { PeriodEditor } from './PeriodEditor';
import { ReviewCommand } from './ReviewCommand';
import styles from '@/shared/ui/forms.module.css';
type Props = { scope: OpsScope; transport: OpsTransport; view: OpsView; reauthHref?: string };
export function OperationsPage(props: Props) {
  return <OperationsContent key={JSON.stringify([props.scope, props.view])} {...props} />;
}
function OperationsContent({ scope, transport, view, reauthHref = '/login' }: Props) {
  const [cursor, setCursor] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [review, setReview] = useState<{ draft: DraftCommand; label: string } | null>(null),
    [message, setMessage] = useState('');
  const [source, setSource] = useState(''),
    [evidence, setEvidence] = useState('');
  const q = useQuery({
    queryKey: ['staff', scope.actorId, scope.permissionRevision, view, cursor, refresh],
    queryFn: ({ signal }) => loadOps(transport, { scope, view, cursor, signal }),
  });
  const value = q.data;
  const reload = () => {
    setReview(null);
    setCursor(null);
    setRefresh((n) => n + 1);
  };
  const showReview = (draft: DraftCommand, label: string) => {
    setMessage('');
    setReview({ draft, label });
  };
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <Button onClick={reload}>รีเฟรชข้อมูล</Button>
      </div>
      {message && <Text role="status">{message}</Text>}
      {q.isPending && <DataState state="loading" />}
      {q.error && (
        <>
          <DataState
            state="error"
            message={
              q.error instanceof OpsError ? q.error.message : 'โหลดข้อมูลเจ้าหน้าที่ไม่สำเร็จ'
            }
            onRetry={reload}
          />
          {q.error instanceof OpsError && ['forbidden', 'reauth'].includes(q.error.code) && (
            <LinkButton href={reauthHref}>เข้าสู่ระบบเจ้าหน้าที่อีกครั้ง</LinkButton>
          )}
        </>
      )}
      {value && !q.error && (
        <>
          <DataState state={value.dataState} message={value.reasons.join(' · ') || undefined} />
          {value.dataState !== 'unavailable' && (
            <>
              <Text variant="caption" tone="muted">
                ข้อมูลถึง {value.dataThrough ? timestamp(value.dataThrough) : 'ยังไม่ระบุ'} ·
                อ้างอิง {value.requestId}
              </Text>
              {view === 'partners' &&
                value.partners.items.map((p) => (
                  <PartnerEditor
                    key={`${p.id}:${value.revision}`}
                    partner={p}
                    agreements={value.agreements}
                    canManage={
                      value.dataState === 'ready' && value.capabilities.includes('manage_partners')
                    }
                    onReview={showReview}
                  />
                ))}
              {view === 'periods' &&
                value.periods.items.map((p) => (
                  <PeriodEditor
                    key={`${p.id}:${value.revision}`}
                    period={p}
                    canPublish={
                      value.dataState === 'ready' &&
                      value.capabilities.includes('publish_statements')
                    }
                    canPay={
                      value.dataState === 'ready' && value.capabilities.includes('record_payments')
                    }
                    onReview={showReview}
                  />
                ))}
              {view === 'imports' && (
                <>
                  {value.capabilities.includes('review_imports') && value.dataState === 'ready' && (
                    <Card title="นำเข้าจากหลักฐานที่อนุมัติ">
                      <form
                        className={styles.form}
                        onSubmit={(e) => {
                          e.preventDefault();
                          showReview(
                            {
                              action: 'import',
                              source: source.trim(),
                              evidenceRef: evidence.trim(),
                            },
                            'เริ่มตรวจข้อมูลนำเข้า',
                          );
                        }}
                      >
                        <Field
                          label="รหัสแหล่งข้อมูล"
                          required
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                        />
                        <Field
                          label="อ้างอิงไฟล์หรือหลักฐานที่อนุมัติ"
                          required
                          value={evidence}
                          onChange={(e) => setEvidence(e.target.value)}
                        />
                        <Button type="submit">ตรวจการนำเข้า</Button>
                      </form>
                    </Card>
                  )}
                  {value.imports.items.map((run) => (
                    <Card
                      key={run.id}
                      title={run.source}
                      description={`${run.id} · ${{ running: 'กำลังประมวลผล', reconciled: 'กระทบยอดผ่าน', failed: 'ไม่สำเร็จ', 'needs-review': 'ต้องตรวจสอบ' }[run.status]}`}
                    >
                      <Text>
                        รับเข้า {run.acceptedCount} · ตัดออก {run.excludedCount} รายการ
                      </Text>
                      <Text variant="caption" tone="muted">
                        เริ่ม {timestamp(run.startedAt)} · เผยแพร่{' '}
                        {run.publishedAt ? timestamp(run.publishedAt) : 'ยังไม่เผยแพร่'}
                      </Text>
                      {run.reasons.length > 0 && (
                        <ul>
                          {run.reasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      )}
                      <Text variant="caption">
                        แก้ข้อมูลหรือหลักฐานที่ต้นทางแล้วนำเข้าใหม่
                        รายการที่ยังไม่ผ่านจะไม่ถูกเผยแพร่อัตโนมัติ
                      </Text>
                    </Card>
                  ))}
                </>
              )}
              {!value[view].items.length && (
                <DataState state="empty" message="ยังไม่มีรายการในหน้านี้" />
              )}
              {(cursor || value[view].nextCursor) && (
                <div className={styles.actions}>
                  <Button disabled={!cursor} onClick={() => setCursor(null)}>
                    รายการแรก
                  </Button>
                  <Button
                    disabled={!value[view].nextCursor}
                    onClick={() => setCursor(value[view].nextCursor)}
                  >
                    ถัดไป
                  </Button>
                </div>
              )}
              {review && (
                <ConfirmAction
                  key={`${scope.actorId}:${scope.permissionRevision}:${value.revision}:${JSON.stringify(review.draft)}`}
                  title={review.label}
                  onClose={() => setReview(null)}
                  onConfirm={async (signal, key) => {
                    try {
                      return await submitOps(transport, scope, value, review.draft, key, signal);
                    } catch (e) {
                      if (e instanceof OpsError && e.code === 'reauth')
                        setMessage('ต้องยืนยันตัวตนเจ้าหน้าที่อีกครั้งก่อนทำรายการ');
                      throw e;
                    }
                  }}
                  onComplete={(text) => {
                    setMessage(text);
                    reload();
                  }}
                >
                  <ReviewCommand command={review.draft} value={value} />
                  <LinkButton href={reauthHref}>ยืนยันตัวตนเจ้าหน้าที่อีกครั้ง</LinkButton>
                </ConfirmAction>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
