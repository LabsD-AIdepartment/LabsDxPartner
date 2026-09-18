'use client';
import { useState } from 'react';
import Link from '@/shared/ui/AppLink';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react';
import type { WithdrawalScopeValue } from '@/contracts/withdrawal-journey';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { Money } from '@/shared/ui/Money';
import { DataState } from '@/shared/ui/DataState';
import { DateRangePicker } from '@/shared/ui/DateRangePicker';
import { addDays, validDateRange } from '@/shared/ui/date-range';
import { dateLabel, timestamp } from '@/shared/ui/format-date';
import { WithdrawalExperience } from './WithdrawalExperience';
import { WithdrawalHistoryExperience } from './WithdrawalHistoryExperience';
import type { WithdrawalHistoryFilters } from './WithdrawalHistory';
import { WithdrawalStatus } from './WithdrawalStatus';
import { WithdrawalProofButton } from './WithdrawalProofButton';
import {
  loadWithdrawalList,
  loadWithdrawalPeriods,
  withdrawalKeys,
  withdrawalScopeKey,
  type WithdrawalStaffTransport,
} from './model';
import {
  buildWalletLedger,
  defaultWalletDateRange,
  filterWalletLedgerByRange,
  type WalletLedgerEntry,
  type WalletReleaseEntry,
} from './wallet-ledger';
import styles from './wallet.module.css';

type Props = {
  scope: WithdrawalScopeValue;
  transport: WithdrawalStaffTransport;
  refreshKey?: number;
  requestRef?: string | null;
  requestHref: (ref: string) => string;
  backHref: string;
  filters?: WithdrawalHistoryFilters;
  onFiltersChange?: (filters: WithdrawalHistoryFilters) => void;
};
export function WithdrawalWallet(props: Props) {
  return <ScopedWallet key={JSON.stringify(withdrawalScopeKey(props.scope))} {...props} />;
}
function ScopedWallet({
  scope,
  transport,
  refreshKey = 0,
  requestRef,
  requestHref,
  backHref,
  filters: controlled,
  onFiltersChange,
}: Props) {
  const [defaults] = useState(() => defaultWalletDateRange(new Date()));
  const [local, setLocal] = useState<WithdrawalHistoryFilters>({
    status: 'all',
    from: '',
    toExclusive: '',
  });
  const filters = controlled ?? local;
  const allDates = !filters.from && !filters.toExclusive;
  const valid = allDates || validDateRange(filters.from, addDays(filters.toExclusive, -1));
  const version = String(refreshKey);
  const list = useQuery({
    queryKey: withdrawalKeys.list(scope, version),
    queryFn: ({ signal }) => loadWithdrawalList(transport, { scope, signal }),
    retry: false,
    staleTime: 0,
  });
  const periods = useQuery({
    queryKey: withdrawalKeys.periods(scope, version),
    queryFn: ({ signal }) => loadWithdrawalPeriods(transport, { scope, signal }),
    retry: false,
    staleTime: 0,
  });
  const withdrawals = !list.isError ? list.data?.items : undefined;
  const released = !periods.isError ? periods.data?.released : undefined;
  const ledger = buildWalletLedger({ withdrawals, released });
  const entries = allDates
    ? ledger.dated
    : valid
      ? filterWalletLedgerByRange(ledger.dated, {
          from: `${filters.from}T00:00:00+07:00`,
          toExclusive: `${filters.toExclusive}T00:00:00+07:00`,
        })
      : [];
  const [selectedRelease, setSelectedRelease] = useState<string | null>(null);
  const release = [...ledger.dated, ...ledger.undatedReleases].find(
    (entry): entry is WalletReleaseEntry =>
      entry.kind === 'release' && entry.id === selectedRelease,
  );
  const loading = list.isPending || periods.isPending;
  const partial = list.isError || periods.isError;
  const stale = list.isFetching || periods.isFetching;
  const changeRange = (range: { from: string; toExclusive: string }) => {
    const next = { ...filters, ...range };
    setLocal(next);
    onFiltersChange?.(next);
    setSelectedRelease(null);
  };
  function row(entry: WalletLedgerEntry) {
    const credit = entry.kind === 'release';
    const at = credit ? entry.releasedAt : entry.at;
    const content = (
      <>
        <span className={styles.direction} aria-hidden>
          {credit ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
        </span>
        <div className={styles.rowIdentity}>
          <strong>{credit ? 'คอมมิชชันเข้ายอดพร้อมถอน' : 'ถอนเงิน'}</strong>
          <span className={styles.muted}>
            {credit ? entry.label : <WithdrawalStatus status={entry.request.status} />}
          </span>
          <span className={styles.muted}>
            {at ? <time dateTime={at}>{timestamp(at)}</time> : 'ยังไม่มีวันที่จากต้นทาง'}
          </span>
        </div>
        <div className={styles.rowAmount}>
          <span className={styles.amountDirection}>
            {credit ? 'เงินเข้า' : entry.request.status === 'paid' ? 'เงินออก' : 'ยอดขอถอน'}
          </span>
          <Money
            value={credit ? entry.releasedAmount : entry.request.gross}
            reason="ยังไม่มีข้อมูลยอดที่ปล่อย"
          />
        </div>
        <ChevronRight size={16} aria-hidden />
      </>
    );
    return (
      <li key={entry.id} className={styles.transaction}>
        {credit ? (
          <button
            type="button"
            className={styles.row}
            onClick={() => setSelectedRelease(entry.id)}
            aria-label={`ดูรายการเงินเข้า ${entry.label}`}
          >
            {content}
          </button>
        ) : (
          <Link
            className={styles.row}
            href={requestHref(entry.request.requestRef)}
            aria-label={`ดูรายการถอน ${entry.request.requestRef}`}
          >
            {content}
          </Link>
        )}
        {!credit && (
          <WithdrawalProofButton
            scope={scope}
            transport={transport}
            request={entry.request}
            refreshKey={refreshKey}
            disabled={stale || list.isError}
          />
        )}
      </li>
    );
  }
  return (
    <WithdrawalExperience
      scope={scope}
      transport={transport}
      refreshKey={refreshKey}
      requestHref={requestHref}
      historyHref={backHref}
      summaryLayout="wide"
    >
      {({ renderSummary, persistenceWarning }) => (
        <div className={styles.wallet}>
          {renderSummary(styles.balance)}
          {persistenceWarning && <p role="status">{persistenceWarning}</p>}
          {requestRef ? (
            <WithdrawalHistoryExperience
              scope={scope}
              transport={transport}
              requestRef={requestRef}
              refreshKey={refreshKey}
              requestHref={requestHref}
              backHref={backHref}
              wallet
            />
          ) : (
            <Card title="รายการเงินเข้า–ออก" className={styles.history}>
              <div className={styles.range} role="group" aria-label="ช่วงวันที่แสดงรายการ">
                <span>
                  {allDates
                    ? 'ทั้งหมด'
                    : valid
                      ? `${dateLabel(filters.from)} – ${dateLabel(addDays(filters.toExclusive, -1))}`
                      : 'ช่วงวันที่ไม่ถูกต้อง'}
                </span>
                <div className={styles.rangeActions}>
                  {!allDates && (
                    <Button onClick={() => changeRange({ from: '', toExclusive: '' })}>
                      ดูทั้งหมด
                    </Button>
                  )}
                  <DateRangePicker
                    value={
                      allDates
                        ? {
                            from: defaults.displayedFromDate,
                            toExclusive: defaults.toExclusive.slice(0, 10),
                          }
                        : { from: filters.from, toExclusive: filters.toExclusive }
                    }
                    onApply={changeRange}
                  />
                </div>
              </div>
              {!valid && <p role="alert">กรุณาเลือกช่วงวันที่ให้ถูกต้อง</p>}
              {loading && <DataState state="loading" message="กำลังโหลดรายการเงินเข้า–ออก" />}
              {partial && (
                <DataState
                  state="error"
                  message={
                    list.isError && periods.isError
                      ? 'โหลดรายการเงินเข้า–ออกไม่สำเร็จ'
                      : `รายการยังไม่ครบ: โหลด${periods.isError ? 'เงินเข้า' : 'รายการถอน'}ไม่สำเร็จ`
                  }
                  onRetry={() => {
                    void list.refetch();
                    void periods.refetch();
                  }}
                />
              )}
              {!loading && !partial && stale && (
                <DataState state="stale" message="กำลังอัปเดตรายการล่าสุด" />
              )}
              {valid && entries.length > 0 && (
                <ul className={styles.transactions} aria-label="รายการเงินเข้า–ออก">
                  {entries.map(row)}
                </ul>
              )}
              {valid && !loading && !partial && entries.length === 0 && (
                <DataState
                  state="empty"
                  message={allDates ? 'ยังไม่มีรายการเงินเข้า–ออก' : 'ไม่มีรายการในช่วงวันที่นี้'}
                />
              )}
              {ledger.undatedReleases.length > 0 && (
                <section className={styles.undated}>
                  <h3>รายการที่ยังไม่ระบุวันที่</h3>
                  <ul className={styles.transactions}>{ledger.undatedReleases.map(row)}</ul>
                </section>
              )}
            </Card>
          )}
          <Dialog
            open={!!release}
            onClose={() => setSelectedRelease(null)}
            title="เงินเข้ายอดพร้อมถอน"
          >
            {release && (
              <div className={styles.releaseDetail}>
                <p>{release.label}</p>
                <Money value={release.releasedAmount} reason="ยังไม่มีข้อมูลยอดที่ปล่อย" />
                <dl>
                  <div>
                    <dt>วันที่เงินเข้า</dt>
                    <dd>
                      {release.releasedAt
                        ? timestamp(release.releasedAt)
                        : 'ยังไม่มีวันที่จากต้นทาง'}
                    </dd>
                  </div>
                </dl>
                <Button onClick={() => setSelectedRelease(null)}>ปิด</Button>
              </div>
            )}
          </Dialog>
        </div>
      )}
    </WithdrawalExperience>
  );
}
