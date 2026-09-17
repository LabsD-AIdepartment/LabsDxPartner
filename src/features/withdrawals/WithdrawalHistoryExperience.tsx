'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  RequestStatus,
  type WithdrawalCancelCommandValue,
  type WithdrawalCancellationReceiptValue,
  type WithdrawalRequestDetailValue,
  type WithdrawalScopeValue,
} from '@/contracts/withdrawal-journey';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { DataState } from '@/shared/ui/DataState';
import { Money } from '@/shared/ui/Money';
import { Text } from '@/shared/ui/Text';
import { WithdrawalDetail } from './WithdrawalDetail';
import { WithdrawalHistory, type WithdrawalHistoryFilters } from './WithdrawalHistory';
import { WithdrawalRequestFacts } from './WithdrawalRequestFacts';
import { WithdrawalProofButton } from './WithdrawalProofButton';
import {
  cancelWithdrawal,
  loadWithdrawalDetail,
  loadWithdrawalList,
  loadWithdrawalSummary,
  recoverCancellation,
  withdrawalKeys,
  withdrawalScopeKey,
  WithdrawalResponseError,
  type WithdrawalHistoryTransport,
} from './model';
import styles from './WithdrawalHistoryExperience.module.css';

export type WithdrawalHistoryExperienceProps = {
  scope: WithdrawalScopeValue;
  transport: WithdrawalHistoryTransport;
  requestRef?: string | null;
  /** An authoritative version notification, independent of earnings/history filters. */
  refreshKey?: string | number;
  filters?: WithdrawalHistoryFilters;
  onFiltersChange?: (filters: WithdrawalHistoryFilters) => void;
  requestHref: (requestRef: string) => string;
  backHref: string;
  periodHref?: (statementId: string) => string;
  balanceAction?: ReactNode;
  wallet?: boolean;
};
type Operation = {
  command: WithdrawalCancelCommandValue;
  state: 'submitting' | 'unknown' | 'resolved';
  message: string;
};
const allTime: WithdrawalHistoryFilters = { status: 'all', from: '', toExclusive: '' };
const uncertain = 'ยังยืนยันผลการยกเลิกไม่ได้ โปรดตรวจสอบรายการเดิมก่อนเริ่มการยกเลิกใหม่';
const reviewChanged = 'ข้อมูลคำขอเปลี่ยนแล้ว กรุณาตรวจสอบรายการล่าสุดอีกครั้งก่อนยืนยัน';
const unsafe = 'ตรวจสอบความถูกต้องของผลไม่ได้ โปรดโหลดข้อมูลล่าสุดและตรวจสอบการยกเลิกรายการเดิม';

function filterIssue(filters: WithdrawalHistoryFilters): string | undefined {
  if (filters.status !== 'all' && !RequestStatus.safeParse(filters.status).success)
    return 'กรุณาเลือกสถานะที่ถูกต้อง';
  if (
    [filters.from, filters.toExclusive].some(
      (value) => value !== '' && !z.iso.date().safeParse(value).success,
    )
  )
    return 'กรุณาระบุวันที่ให้ถูกต้อง';
  if (filters.from && filters.toExclusive && filters.from >= filters.toExclusive)
    return 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น และไม่รวมวันสิ้นสุด';
}
function resolutionMessage(receipt: WithdrawalCancellationReceiptValue): string {
  if (receipt.outcome === 'accepted') return 'ยืนยันการยกเลิกคำขอถอนแล้ว';
  if (receipt.outcome === 'unknown') return uncertain;
  if (receipt.outcome === 'operation_failed')
    return 'การดำเนินการยกเลิกไม่สำเร็จ ไม่ใช่สถานะถอนเงินล้มเหลว โปรดตรวจสอบข้อมูลล่าสุดก่อนเริ่มใหม่';
  if (receipt.code === 'stale_revision') return reviewChanged;
  if (receipt.code === 'not_cancellable')
    return 'คำขอนี้ไม่สามารถยกเลิกได้แล้ว โปรดตรวจสอบสถานะล่าสุด';
  return 'การยกเลิกถูกปฏิเสธ โปรดตรวจสอบข้อมูลล่าสุดก่อนดำเนินการ';
}

/** Identity changes discard UI snapshots synchronously. The transport owns durable commands. */
export function WithdrawalHistoryExperience(props: WithdrawalHistoryExperienceProps) {
  return (
    <ScopedHistory
      key={JSON.stringify([...withdrawalScopeKey(props.scope), props.requestRef ?? null])}
      {...props}
    />
  );
}

function ScopedHistory({
  scope,
  transport,
  requestRef = null,
  refreshKey = 0,
  filters: controlledFilters,
  onFiltersChange,
  requestHref,
  backHref,
  periodHref,
  balanceAction,
  wallet = false,
}: WithdrawalHistoryExperienceProps) {
  const client = useQueryClient();
  const [localFilters, setLocalFilters] = useState(allTime);
  const filters = controlledFilters ?? localFilters;
  const [review, setReview] = useState<{
    detail: WithdrawalRequestDetailValue;
    version: string | number;
  } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [operation, setOperationState] = useState<Operation | null>(null);
  const operationRef = useRef(operation);
  const setOperation = (next: Operation) => {
    operationRef.current = next;
    setOperationState(next);
  };
  const [checkingKey, setCheckingKey] = useState<string | undefined>();
  const [invalidCommandResponse, setInvalidCommandResponse] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshCount = useRef(0);
  const alive = useRef(true);
  const lock = useRef(false);
  const reviewConsumed = useRef(false);
  const recoveryRead = useRef<AbortController | null>(null);
  const recoveryGeneration = useRef(0);
  const version = String(refreshKey);
  const summary = useQuery({
    queryKey: withdrawalKeys.summary(scope, version),
    queryFn: ({ signal }) => loadWithdrawalSummary(transport, { scope, signal }),
    enabled: requestRef === null,
    retry: false,
    staleTime: 0,
  });
  const list = useQuery({
    queryKey: withdrawalKeys.list(scope, version),
    queryFn: ({ signal }) => loadWithdrawalList(transport, { scope, signal }),
    enabled: requestRef === null,
    retry: false,
    staleTime: 0,
  });
  const detailQuery = useQuery({
    queryKey: withdrawalKeys.detail(scope, requestRef ?? '', version),
    queryFn: ({ signal }) =>
      loadWithdrawalDetail(transport, { scope, requestRef: requestRef!, signal }),
    enabled: requestRef !== null,
    retry: false,
    staleTime: 0,
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recoveryGeneration.current += 1;
      recoveryRead.current?.abort();
    };
  }, []);
  const previousVersion = useRef(refreshKey);
  useEffect(() => {
    if (previousVersion.current === refreshKey) return;
    previousVersion.current = refreshKey;
    recoveryGeneration.current += 1;
    recoveryRead.current?.abort();
    setCheckingKey(undefined);
    if (operationRef.current?.state !== 'submitting') lock.current = false;
  }, [refreshKey]);
  useEffect(() => {
    if (detailQuery.isSuccess && !detailQuery.isFetching) setInvalidCommandResponse(false);
  }, [detailQuery.dataUpdatedAt, detailQuery.isSuccess, detailQuery.isFetching]);

  // Never expose an old snapshot after an invalid envelope or a read outage. A valid cached
  // snapshot may be displayed only while its read is in flight, with all actions disabled.
  const detailInvalid =
    invalidCommandResponse || detailQuery.error instanceof WithdrawalResponseError;
  const detail =
    !detailInvalid && !detailQuery.isError && detailQuery.data?.state === 'found'
      ? detailQuery.data.detail
      : null;
  const detailState = detailInvalid
    ? 'invalid'
    : detailQuery.isError
      ? 'read-error'
      : detailQuery.isFetching || refreshing
        ? detail
          ? 'stale'
          : 'loading'
        : detailQuery.data?.state === 'missing'
          ? 'missing'
          : detail
            ? 'ready'
            : 'unavailable';
  const fresh = detailState === 'ready';
  const unresolved = operation?.state === 'submitting' || operation?.state === 'unknown';
  const busy = operation?.state === 'submitting' || !!checkingKey;
  const cancellable =
    fresh &&
    !!detail?.request.allowedActions.includes('cancel') &&
    detail.pendingCancellations.length === 0 &&
    !unresolved &&
    !busy;
  const reviewCurrent =
    cancellable &&
    !!review &&
    review.version === refreshKey &&
    review.detail.revision === detail?.revision &&
    review.detail.request.idempotencyKey === detail?.request.idempotencyKey;

  async function refresh() {
    // Invalidate the shared scope after every command outcome; all money remains server-derived.
    refreshCount.current += 1;
    if (alive.current) setRefreshing(true);
    try {
      await client.cancelQueries({ queryKey: withdrawalScopeKey(scope) });
      await client.invalidateQueries({ queryKey: withdrawalScopeKey(scope) });
    } finally {
      refreshCount.current -= 1;
      if (alive.current && refreshCount.current === 0) setRefreshing(false);
    }
  }
  function openReview() {
    if (
      !cancellable ||
      lock.current ||
      refreshCount.current > 0 ||
      !detail ||
      operationRef.current?.state === 'submitting' ||
      operationRef.current?.state === 'unknown'
    )
      return;
    reviewConsumed.current = false;
    setReview({ detail, version: refreshKey });
    setDialogOpen(true);
  }
  async function confirm() {
    if (
      lock.current ||
      refreshCount.current > 0 ||
      reviewConsumed.current ||
      !reviewCurrent ||
      !review
    )
      return;
    lock.current = true; // Synchronous: two clicks before the next render still send one command.
    reviewConsumed.current = true;
    const candidateKey = `cancel-${crypto.randomUUID()}`;
    const command: WithdrawalCancelCommandValue = Object.freeze({
      scope: Object.freeze({ ...scope }),
      requestRef: review.detail.request.requestRef,
      requestIdempotencyKey: review.detail.request.idempotencyKey,
      operationKey:
        candidateKey === review.detail.request.idempotencyKey
          ? `operation-${candidateKey}`
          : candidateKey,
      expectedRevision: review.detail.revision,
    });
    setOperation({
      command,
      state: 'submitting',
      message: 'กำลังส่งคำขอยกเลิก ปิดหน้าต่างได้โดยการดำเนินการยังคงอยู่',
    });
    try {
      // This signal is deliberately NOT connected to unmount, read refresh, or dialog close.
      const result = await cancelWithdrawal(transport, {
        command,
        signal: new AbortController().signal,
      });
      if (!alive.current || operationRef.current?.command !== command) return;
      setOperation({
        command,
        state: result.outcome === 'unknown' ? 'unknown' : 'resolved',
        message: resolutionMessage(result.receipt),
      });
      setDialogOpen(false);
      setReview(null);
    } catch (error) {
      if (!alive.current || operationRef.current?.command !== command) return;
      setOperation({
        command,
        state: 'unknown',
        message: error instanceof WithdrawalResponseError ? unsafe : uncertain,
      });
      setInvalidCommandResponse(error instanceof WithdrawalResponseError);
      setDialogOpen(false);
      setReview(null);
    } finally {
      if (alive.current) lock.current = false;
      // Even after navigation, completion invalidates the old scope's visible projections.
      void refresh();
    }
  }
  async function recover(command: WithdrawalCancelCommandValue) {
    if (lock.current || refreshCount.current > 0 || !fresh) return;
    lock.current = true;
    const generation = ++recoveryGeneration.current;
    const controller = new AbortController();
    recoveryRead.current?.abort();
    recoveryRead.current = controller;
    setCheckingKey(command.operationKey);
    setOperation({ command, state: 'unknown', message: uncertain });
    try {
      const result = await recoverCancellation(transport, {
        scope,
        requestRef: command.requestRef,
        operationKey: command.operationKey,
        signal: controller.signal,
      });
      if (!alive.current || generation !== recoveryGeneration.current) return;
      if (result.state === 'missing') {
        setOperation({
          command,
          state: 'unknown',
          message:
            'ยังไม่พบผลของรหัสการยกเลิกเดิม ยังยืนยันไม่ได้และจะไม่ส่งการยกเลิกใหม่อัตโนมัติ',
        });
      } else {
        if (
          result.receipt.requestIdempotencyKey !== command.requestIdempotencyKey ||
          result.receipt.expectedRevision !== command.expectedRevision
        )
          throw new WithdrawalResponseError(
            'identity_mismatch',
            'Recovered operation does not match the reviewed command',
          );
        setOperation({
          command,
          state: result.receipt.outcome === 'unknown' ? 'unknown' : 'resolved',
          message: resolutionMessage(result.receipt),
        });
      }
    } catch (error) {
      if (!alive.current || generation !== recoveryGeneration.current) return;
      setOperation({
        command,
        state: 'unknown',
        message:
          error instanceof WithdrawalResponseError
            ? unsafe
            : 'ตรวจสอบผลไม่ได้ กรุณาตรวจสอบรหัสการยกเลิกเดิมอีกครั้ง',
      });
      setInvalidCommandResponse(error instanceof WithdrawalResponseError);
    } finally {
      if (alive.current && generation === recoveryGeneration.current) {
        lock.current = false;
        setCheckingKey(undefined);
      }
      if (!controller.signal.aborted) void refresh();
    }
  }
  const recoverReceipt = (receipt: WithdrawalCancellationReceiptValue) =>
    recover({
      scope: receipt.scope,
      operationKey: receipt.operationKey,
      requestRef: receipt.requestRef,
      requestIdempotencyKey: receipt.requestIdempotencyKey,
      expectedRevision: receipt.expectedRevision,
    });

  if (requestRef === null) {
    const balance =
      !summary.isError && summary.data?.balance.state === 'known' ? summary.data.balance : null;
    const balanceState = summary.isError
      ? 'error'
      : summary.isFetching || refreshing
        ? balance
          ? 'stale'
          : 'loading'
        : balance
          ? 'ready'
          : 'unavailable';
    const issue = filterIssue(filters);
    const invalid = list.error instanceof WithdrawalResponseError;
    const snapshot = !invalid && !list.isError ? list.data : undefined;
    const state = invalid
      ? 'invalid'
      : list.isError
        ? 'read-error'
        : list.isFetching || refreshing
          ? snapshot
            ? 'stale'
            : 'loading'
          : snapshot
            ? 'ready'
            : 'unavailable';
    // Date-only input means midnight in the same Bangkok business timezone used by labels.
    const from = filters.from ? Date.parse(`${filters.from}T00:00:00+07:00`) : -Infinity;
    const to = filters.toExclusive ? Date.parse(`${filters.toExclusive}T00:00:00+07:00`) : Infinity;
    const rows = snapshot?.items ?? [];
    const filtered = issue
      ? rows
      : rows.filter(
          (row) =>
            (filters.status === 'all' || row.status === filters.status) &&
            Date.parse(row.submittedAt) >= from &&
            Date.parse(row.submittedAt) < to,
        );
    return (
      <WithdrawalHistory
        balanceSummary={
          <section
            className={styles.balance}
            aria-label="ยอดพร้อมถอน"
            aria-busy={summary.isFetching}
          >
            <Text variant="label">ยอดพร้อมถอน</Text>
            <div className={styles.balanceRow}>
              <Money
                value={balance?.available ?? null}
                reason="ยังไม่มีข้อมูลยอดพร้อมถอน"
                className={styles.balanceAmount}
              />
              {balanceAction}
            </div>
            {balanceState !== 'ready' && (
              <DataState
                state={balanceState}
                message={
                  balanceState === 'loading'
                    ? 'กำลังตรวจสอบยอดพร้อมถอน'
                    : balanceState === 'stale'
                      ? 'แสดงยอดครั้งล่าสุด กำลังตรวจสอบยอดพร้อมถอน'
                      : balanceState === 'error'
                        ? 'โหลดข้อมูลยอดพร้อมถอนไม่สำเร็จ'
                        : 'ยังไม่มีข้อมูลยอดพร้อมถอน'
                }
                onRetry={
                  balanceState === 'error' || balanceState === 'unavailable'
                    ? () => void summary.refetch()
                    : undefined
                }
              />
            )}
          </section>
        }
        requests={filtered}
        state={state}
        filters={filters}
        filterError={issue}
        onFiltersChange={(next) => {
          if (!controlledFilters) setLocalFilters(next);
          onFiltersChange?.(next);
        }}
        emptyKind={rows.length === 0 ? 'history' : 'filtered'}
        requestHref={requestHref}
        onRetry={() => void refresh()}
      />
    );
  }
  const localRecovery =
    operation?.state === 'unknown' &&
    detail &&
    !detail.pendingCancellations.some(
      (receipt) => receipt.operationKey === operation.command.operationKey,
    );
  return (
    <div className={styles.experience}>
      {operation && (
        <div className={styles.operation}>
          <Text role="status">{operation.message}</Text>
          {localRecovery && (
            <Button disabled={!fresh || busy} onClick={() => void recover(operation.command)}>
              ตรวจสอบผลการยกเลิกรายการเดิม
            </Button>
          )}
        </div>
      )}
      <WithdrawalDetail
        wallet={wallet}
        proofAction={
          fresh && detail?.request.status === 'paid' ? (
            <WithdrawalProofButton
              scope={scope}
              transport={transport}
              request={detail.request}
              refreshKey={refreshKey}
            />
          ) : undefined
        }
        compactAmountDetails
        detail={detail}
        state={detailState}
        backHref={backHref}
        periodHref={periodHref}
        onRetry={() => void refresh()}
        actions={{
          busy,
          cancel: { enabled: cancellable, onClick: openReview },
          checkStatus: { enabled: fresh && !busy, onClick: () => void refresh() },
          recoverCancellation: {
            enabled: fresh && !busy,
            checkingOperationKey: checkingKey,
            onClick: (receipt) => void recoverReceipt(receipt),
          },
        }}
      />
      {review && detail && (
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="ยืนยันการยกเลิกคำขอถอน"
        >
          <div className={styles.confirmation}>
            <Text>
              โปรดตรวจสอบคำขอที่จะยกเลิก ยอดจะเปลี่ยนเมื่อระบบยืนยันผลการยกเลิกแล้วเท่านั้น
            </Text>
            <WithdrawalRequestFacts request={review.detail.request} />
            {!reviewCurrent && !busy && <Text role="alert">{reviewChanged}</Text>}
            <div className={styles.actions}>
              <Button onClick={() => setDialogOpen(false)}>กลับไปดูรายละเอียด</Button>
              {reviewCurrent || busy ? (
                <Button
                  variant="primary"
                  disabled={!reviewCurrent || busy}
                  onClick={() => void confirm()}
                >
                  {busy ? 'กำลังดำเนินการ…' : 'ยืนยันยกเลิกคำขอ'}
                </Button>
              ) : (
                <Button disabled={!cancellable} onClick={openReview}>
                  ตรวจสอบรายการล่าสุด
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
