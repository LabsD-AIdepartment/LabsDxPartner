'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { partnerKey } from '@/shared/query/keys';
import { Card } from '@/shared/ui/Card';
import { Text } from '@/shared/ui/Text';
import { Money } from '@/shared/ui/Money';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Dialog } from '@/shared/ui/Dialog';
import { DataState } from '@/shared/ui/DataState';
import { StatusBadge } from '@/shared/ui/StatusBadge';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import { loadTransactions, transactionHref } from './model';
import { TransactionState } from './TransactionState';
import { SettlementBridge } from './SettlementBridge';
import { DocumentList } from './DocumentList';
import type { TransactionsProps } from './types';
import styles from './transactions.module.css';
export function StatementDetail(props: TransactionsProps & { statementId: string }) {
  const [support, setSupport] = useState(false);
  const [pages, setPages] = useState<{
    lineCursor: string | null;
    settlementCursor: string | null;
    version?: string;
    revision?: string;
  }>({ lineCursor: null, settlementCursor: null });
  const [refreshId, setRefreshId] = useState(0);
  const q = useQuery({
    queryKey: partnerKey(
      props.scope,
      'settlements',
      'statement',
      {
        id: props.statementId,
        refresh: String(refreshId),
        lineCursor: pages.lineCursor,
        settlementCursor: pages.settlementCursor,
        version: pages.version ?? null,
      },
      pages.revision,
    ),
    queryFn: ({ signal }) =>
      loadTransactions(props.transport, {
        scope: props.scope,
        resource: 'detail',
        statementId: props.statementId,
        ...pages,
        signal,
      }),
    retry: false,
  });
  function refresh() {
    setPages({ lineCursor: null, settlementCursor: null });
    setRefreshId((x) => x + 1);
  }
  const value = q.data,
    d = value?.data,
    s = d?.statement;
  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <LinkButton href={transactionHref(props.basePath, undefined, props.returnTo)}>
          ← กลับรอบจ่ายทั้งหมด
        </LinkButton>
        <LinkButton href={props.returnTo}>กลับหน้าก่อนหน้า</LinkButton>
        <Button onClick={refresh}>รีเฟรช</Button>
      </div>
      <TransactionState pending={q.isPending} error={q.error} retry={refresh} />
      {value && d && s && !q.error && (
        <>
          <DataState state={value.dataState} message={value.reasons.join(' · ') || undefined} />
          {value.dataState !== 'unavailable' && (
            <>
              <Card
                title="รายละเอียดรอบจ่าย"
                action={<StatusBadge status={s.status} />}
                className={styles.highlight}
              >
                <Text variant="sectionTitle">
                  {dateLabel(s.period.from)} – ก่อน {dateLabel(s.period.toExclusive)}
                </Text>
                <Text variant="caption" tone="muted">
                  {s.id} · เวอร์ชัน {s.version} · เผยแพร่ {timestamp(s.publishedAt)}
                </Text>
                <div className={styles.summary}>
                  <div>
                    <Text variant="caption">ยอดคงเหลือ</Text>
                    <Money className={styles.figure} value={s.closing} />
                  </div>
                  <div>
                    <Text variant="caption" tone="muted">
                      กำหนดจ่าย
                    </Text>
                    <Text>{s.scheduledAt ? dateLabel(s.scheduledAt) : 'ยังไม่ระบุ'}</Text>
                  </div>
                </div>
                <Text variant="caption" tone="muted">
                  สถานะการจ่ายล่าสุด ณ {timestamp(s.settlementAsOf)} · การจ่ายภายหลังยังแสดงในงวดนี้
                </Text>
              </Card>
              <div className={styles.columns}>
                <SettlementBridge statement={s} />
                <Card title="ประวัติการชำระ">
                  <div className={styles.rows}>
                    {!d.settlements.items.length && (
                      <Text tone="muted">ยังไม่มีรายการชำระที่บันทึก</Text>
                    )}
                    {d.settlements.items.map((p) => (
                      <div className={styles.payment} key={p.id}>
                        <Text as="h3" variant="label">
                          {p.kind === 'reversal' ? 'กลับรายการ · ' : ''}
                          {p.reference}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {p.kind === 'reversal' ? 'กลับรายการ' : 'จ่ายจริง'}{' '}
                          {p.paidAt ? timestamp(p.paidAt) : 'ยังไม่มีวันที่จากต้นทาง'}
                          <br />
                          บันทึก {timestamp(p.recordedAt)}
                        </Text>
                        <dl className={styles.bridge}>
                          {(
                            [
                              ['เงินโอน', p.cash],
                              ['ภาษีหัก ณ ที่จ่าย', p.withholding],
                              ['ชำระด้วยวิธีอื่น', p.other],
                              ['รวมชำระภาระ', p.obligationSettled],
                            ] as const
                          ).map(([label, amount]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>
                                <Money value={amount} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <Text variant="caption" tone="muted">
                          อ้างอิงหลักฐาน {p.evidenceRef}
                        </Text>
                        {p.otherReasonRef && (
                          <Text variant="caption">วิธีชำระอื่นอ้างอิง {p.otherReasonRef}</Text>
                        )}
                        {p.kind === 'reversal' && (
                          <details>
                            <summary>ที่มาของการกลับรายการ</summary>
                            <Text variant="caption">รายการเดิม {p.originalSettlementId}</Text>
                            <Text variant="caption">เหตุผลอ้างอิง {p.reasonRef}</Text>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                  {(d.settlements.nextCursor || pages.settlementCursor) && (
                    <div className={styles.pager}>
                      <Button
                        disabled={!pages.settlementCursor}
                        onClick={() => setPages({ ...pages, settlementCursor: null })}
                      >
                        รายการแรก
                      </Button>
                      <Button
                        disabled={!d.settlements.nextCursor}
                        onClick={() =>
                          setPages({
                            ...pages,
                            settlementCursor: d.settlements.nextCursor,
                            revision: value.settlementsRevision,
                            version: s.version,
                          })
                        }
                      >
                        การชำระถัดไป
                      </Button>
                    </div>
                  )}
                  <Text variant="caption" tone="muted">
                    เงินโอนและภาษีแสดงแยกกัน ยอดชำระภาระอาจไม่เท่ากับเงินเข้าบัญชี
                  </Text>
                </Card>
              </div>
              <Card>
                <details>
                  <summary>รายการรายได้และรายการปรับปรุง</summary>
                  <div className={styles.rows}>
                    {d.lines.items.map((line) => (
                      <div className={styles.payment} key={line.id}>
                        <div className={styles.row}>
                          <Text as="strong" variant="label">
                            {
                              {
                                commission: 'คอมมิชชัน',
                                'fixed-fee': 'ค่าจ้างตามข้อตกลง',
                                bonus: 'โบนัส',
                                adjustment: 'รายการปรับปรุง',
                              }[line.kind]
                            }
                          </Text>
                          <Money value={line.amount} />
                        </div>
                        <Text variant="caption" tone="muted">
                          เกิดรายได้ {dateLabel(line.earnedAt)} ·{' '}
                          {line.contentId ?? 'รายได้ระดับพาร์ทเนอร์'}
                        </Text>
                        {line.reason && <Text>{line.reason}</Text>}
                        <details>
                          <summary>ที่มาและวิธีคำนวณ</summary>
                          <Text variant="caption">
                            อ้างอิง {line.sourceRef} · ข้อตกลง {line.agreementVersion}
                          </Text>
                          {line.eligibleBase && (
                            <Text variant="caption">
                              ฐานยอดขาย <Money value={line.eligibleBase} />
                              {line.ratePpm !== null
                                ? ' · อัตรา ' + line.ratePpm / 10000 + '%'
                                : ''}
                            </Text>
                          )}
                          <Text variant="caption">
                            หลักฐาน {line.evidenceRef}
                            {line.originalLineId ? ' · ปรับจาก ' + line.originalLineId : ''}
                          </Text>
                        </details>
                      </div>
                    ))}
                  </div>
                  {!d.lines.items.length && <Text tone="muted">ไม่มีรายการรายได้ใหม่ในงวดนี้</Text>}
                  {(d.lines.nextCursor || pages.lineCursor) && (
                    <div className={styles.pager}>
                      <Button
                        disabled={!pages.lineCursor}
                        onClick={() => setPages({ ...pages, lineCursor: null })}
                      >
                        รายการแรก
                      </Button>
                      <Button
                        disabled={!d.lines.nextCursor}
                        onClick={() =>
                          setPages({
                            ...pages,
                            lineCursor: d.lines.nextCursor,
                            revision: value.settlementsRevision,
                            version: s.version,
                          })
                        }
                      >
                        รายได้ถัดไป
                      </Button>
                    </div>
                  )}
                </details>
              </Card>
              <DocumentList
                key={`${s.id}:${s.version}:${value.settlementsRevision}`}
                {...props}
                data={d}
              />
              <Button onClick={() => setSupport(true)}>สอบถามเกี่ยวกับรอบจ่ายนี้</Button>
              <Dialog title="สอบถามรอบจ่าย" open={support} onClose={() => setSupport(false)}>
                <Text>ติดต่อผู้ดูแล Labs D ผ่านช่องทางที่คุณใช้อยู่ พร้อมแจ้งข้อมูลนี้</Text>
                <Text variant="label">
                  รอบ {s.id} · เวอร์ชัน {s.version}
                </Text>
                <Text>
                  ช่วง {dateLabel(s.period.from)} – ก่อน {dateLabel(s.period.toExclusive)}
                </Text>
                <Text>
                  ยอดคงเหลือ <Money value={s.closing} />
                </Text>
                {props.supportUrl?.startsWith('https://') && (
                  <LinkButton href={props.supportUrl} target="_blank" rel="noopener noreferrer">
                    เปิดช่องทางติดต่อ
                  </LinkButton>
                )}
              </Dialog>
            </>
          )}
        </>
      )}
    </div>
  );
}
