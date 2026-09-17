'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { scopeKey, type QueryScope } from '@/shared/query/keys';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { DataState } from '@/shared/ui/DataState';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { dateLabel } from '@/shared/ui/format-date';
import { actOnAccount, loadAccount, type AccountTransport, type Action } from './model';
import styles from '@/shared/ui/forms.module.css';
import type { ReactNode } from 'react';
type Props = {
  scope: QueryScope;
  transport: AccountTransport;
  onLogout: () => void;
  reauthHref?: string;
  credentials?: ReactNode;
};
export function AccountPage(props: Props) {
  return <AccountContent key={JSON.stringify(scopeKey(props.scope))} {...props} />;
}
function AccountContent({
  scope,
  transport,
  onLogout,
  reauthHref = '/login?next=%2Faccount',
  credentials,
}: Props) {
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null),
    [message, setMessage] = useState(''),
    [needsAuth, setNeedsAuth] = useState(false);
  const q = useQuery({
    queryKey: [...scopeKey(scope), 'account'],
    queryFn: ({ signal }) => loadAccount(transport, scope, signal),
  });
  const data = q.data?.data;
  const clearReview = () => setAction(null);
  return (
    <div className={styles.stack}>
      {q.isPending && <DataState state="loading" />}
      {q.error && (
        <DataState state="error" message="โหลดบัญชีไม่สำเร็จ" onRetry={() => void q.refetch()} />
      )}
      {message && <Text role="status">{message}</Text>}
      {needsAuth && <LinkButton href={reauthHref}>ยืนยันตัวตนอีกครั้ง</LinkButton>}
      {q.data && !q.error && (
        <DataState state={q.data.dataState} message={q.data.reasons.join(' · ') || undefined} />
      )}
      {q.data && data && !q.error && q.data.dataState !== 'unavailable' && (
        <>
          {' '}
          <Card title="บัญชีของคุณ">
            <TextGroup>
              <Text variant="sectionTitle">{data.displayName}</Text>
              <Text variant="caption" tone="muted">
                ชื่อผู้ใช้: {data.username}
              </Text>
            </TextGroup>
          </Card>
          <Card title="ข้อตกลงของคุณ">
            {data.agreement ? (
              <div className={styles.details}>
                <TextGroup>
                  <Text leading="reading">
                    {data.termsSummary ?? 'รายละเอียดเงื่อนไขอยู่ในข้อตกลงที่คุณทำกับ Labs D'}
                  </Text>
                  <Text variant="caption" tone="muted">
                    มีผล {dateLabel(data.agreement.effective.from)} – ก่อน{' '}
                    {dateLabel(data.agreement.effective.toExclusive)}
                  </Text>
                </TextGroup>
                <details>
                  <summary>รายละเอียดข้อตกลง</summary>
                  <TextGroup>
                    <Text variant="caption">
                      เวอร์ชัน {data.agreement.id} · อ้างอิง {data.agreement.evidenceRef}
                    </Text>
                    <Text variant="caption">
                      คำนวณ
                      {
                        { day: 'รายวัน', month: 'รายเดือน', statement: 'ตามงวดสรุป' }[
                          data.agreement.calculationPeriod
                        ]
                      }{' '}
                      · ปัดเศษ
                      {data.agreement.roundingRule.mode === 'per-line' ? 'ทีละรายการ' : 'รวมตามงวด'}
                    </Text>
                  </TextGroup>
                </details>
              </div>
            ) : (
              <Text tone="muted">ยังไม่มีข้อตกลงที่ยืนยันสำหรับบัญชีนี้ กรุณาติดต่อผู้ดูแล</Text>
            )}
          </Card>
        </>
      )}
      {/* Stable slot: metadata loading/retry must never remount an active password form. */}
      {credentials}
      {q.data && data && !q.error && q.data.dataState !== 'unavailable' && (
        <>
          {' '}
          <Card title="ความช่วยเหลือ">
            <Text>ติดต่อผู้ดูแล Labs D ผ่านช่องทางที่ใช้อยู่ หากต้องตรวจสอบบัญชีหรือข้อตกลง</Text>
            <Button onClick={() => setAction({ action: 'recover' })}>
              ลืมรหัสผ่านหรือเข้าใช้งานไม่ได้
            </Button>
            {data.supportUrl && (
              <LinkButton href={data.supportUrl} target="_blank" rel="noopener noreferrer">
                ติดต่อผู้ดูแล
              </LinkButton>
            )}
          </Card>
          <Button onClick={() => setAction({ action: 'logout' })}>ออกจากระบบ</Button>
          {action && (
            <ConfirmAction
              key={`${scope.userId}:${scope.partnerId}:${scope.permissionRevision}:${q.data!.revision}:${JSON.stringify(action)}`}
              title={action.action === 'logout' ? 'ออกจากระบบ' : 'กู้คืนการเข้าใช้งาน'}
              onClose={clearReview}
              onConfirm={async (signal, idempotencyKey) => {
                const result = await actOnAccount(transport, {
                  scope,
                  expectedRevision: q.data!.revision,
                  idempotencyKey,
                  command: action,
                  signal,
                });
                setNeedsAuth(result.status === 'requires-reauth');
                if (result.status === 'complete') {
                  if (action.action === 'logout') {
                    await client.cancelQueries();
                    client.clear();
                    onLogout();
                  } else
                    await client.invalidateQueries({
                      queryKey: [...scopeKey(scope), 'account'],
                    });
                }
                return result;
              }}
              onComplete={(text) => {
                setMessage(text);
                clearReview();
              }}
            >
              <Text>{data.displayName}</Text>
              <Text>
                {action.action === 'logout'
                  ? 'ออกจากบัญชีนี้และล้างข้อมูลที่แสดงบนเครื่องนี้'
                  : 'ติดต่อผู้ดูแล Labs D ที่ประสานงานกับคุณ เมื่อยืนยันเจ้าของบัญชีแล้ว ทีมจะส่งลิงก์ให้ตั้งรหัสผ่านใหม่ด้วยตัวเอง'}
              </Text>
            </ConfirmAction>
          )}
        </>
      )}
    </div>
  );
}
