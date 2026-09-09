'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { partnerKey } from '@/shared/query/keys';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Money } from '@/shared/ui/Money';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Button } from '@/shared/ui/Button';
import { DataState } from '@/shared/ui/DataState';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import { loadTransactions, transactionHref, type StatementStatus } from './model';
import { TransactionState } from './TransactionState';
import type { TransactionsProps } from './types';
import styles from './transactions.module.css';
const labels: Record<StatementStatus, string> = {
  all: 'ทุกสถานะ',
  pending: 'รอจ่าย',
  'part-paid': 'จ่ายบางส่วน',
  paid: 'จ่ายแล้ว',
  credit: 'เครดิตยกไป',
};
export function StatementList(props: TransactionsProps) {
  const [status, setStatus] = useState<StatementStatus>('all');
  const [paging, setPaging] = useState<{
    cursor: string | null;
    history: (string | null)[];
    revision?: string;
  }>({ cursor: null, history: [] });
  const [refreshId, setRefreshId] = useState(0);
  const q = useQuery({
    queryKey: partnerKey(
      props.scope,
      'settlements',
      'statements',
      { status, cursor: paging.cursor, refresh: String(refreshId) },
      paging.revision,
    ),
    queryFn: ({ signal }) =>
      loadTransactions(props.transport, {
        scope: props.scope,
        resource: 'list',
        status,
        cursor: paging.cursor,
        revision: paging.revision,
        signal,
      }),
    retry: false,
  });
  const value = q.data;
  function refresh() {
    setPaging({ cursor: null, history: [] });
    setRefreshId((x) => x + 1);
  }
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <LinkButton href={props.returnTo}>← กลับหน้าก่อนหน้า</LinkButton>
        <label className={styles.filter}>
          สถานะรอบจ่าย
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatementStatus);
              setPaging({ cursor: null, history: [] });
            }}
          >
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={refresh}>รีเฟรช</Button>
      </div>
      <TransactionState pending={q.isPending} error={q.error} retry={refresh} />
      {value && !q.error && (
        <>
          <DataState state={value.dataState} message={value.reasons.join(' · ') || undefined} />
          {value.dataState !== 'unavailable' && (
            <>
              <Card
                title="ยืนยันแล้ว ยังไม่จ่าย"
                description="ยอดคงค้างทุกงวด แยกจากช่วงรายได้และสถานะที่กรอง"
                className={styles.highlight}
              >
                <Money className={styles.figure} value={value.confirmedUnpaid} />
                <Text variant="caption" tone="muted">
                  สถานะการจ่าย ณ {timestamp(value.asOf)}
                </Text>
              </Card>
              <Card title="รอบจ่ายของคุณ">
                <div className={styles.rows}>
                  {!value.data.items.length && (
                    <DataState state="empty" message="ยังไม่มีรอบจ่ายในสถานะนี้" />
                  )}
                  {value.data.items.map((s) => (
                    <a
                      className={styles.statement}
                      key={s.id}
                      href={transactionHref(props.basePath, s.id, props.returnTo)}
                    >
                      <div>
                        <Text as="h3" variant="cardTitle">
                          {dateLabel(s.period.from)} – ก่อน {dateLabel(s.period.toExclusive)}
                        </Text>
                        <Text variant="caption" tone="muted">
                          เผยแพร่ {dateLabel(s.publishedAt)} · {s.id}
                        </Text>
                        <StatusBadge status={s.status} />
                      </div>
                      <div className={styles.amount}>
                        <Text variant="caption" tone="muted">
                          ยอดคงเหลือ
                        </Text>
                        <Money value={s.closing} />
                        <Text variant="caption">
                          {s.scheduledAt
                            ? 'กำหนดจ่าย ' + dateLabel(s.scheduledAt)
                            : 'ยังไม่มีกำหนดจ่าย'}
                        </Text>
                      </div>
                      <span aria-hidden>↗</span>
                    </a>
                  ))}
                </div>
                {(paging.history.length > 0 || value.data.nextCursor) && (
                  <nav className={styles.pager} aria-label="หน้ารอบจ่าย">
                    <Button
                      disabled={!paging.history.length}
                      onClick={() =>
                        setPaging({
                          ...paging,
                          cursor: paging.history.at(-1) ?? null,
                          history: paging.history.slice(0, -1),
                        })
                      }
                    >
                      ก่อนหน้า
                    </Button>
                    <Text as="span" variant="caption">
                      หน้า {paging.history.length + 1}
                    </Text>
                    <Button
                      disabled={!value.data.nextCursor}
                      onClick={() =>
                        setPaging({
                          cursor: value.data.nextCursor,
                          history: [...paging.history, paging.cursor],
                          revision: value.settlementsRevision,
                        })
                      }
                    >
                      ถัดไป
                    </Button>
                  </nav>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
