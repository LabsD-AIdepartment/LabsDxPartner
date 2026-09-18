'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  WithdrawalRequestValue,
  WithdrawalScopeValue,
  WithdrawalSubmissionValue,
} from '@/contracts/withdrawal-journey';
import {
  loadWithdrawalQuote,
  loadWithdrawalSummary,
  parseThbAmountToMinor,
  recoverWithdrawal,
  submitWithdrawal,
  withdrawalKeys,
  withdrawalScopeKey,
  WithdrawalResponseError,
  type AmountParseError,
  type WithdrawalTransport,
} from './model';
import { WithdrawalSummary } from './WithdrawalSummary';
import {
  WithdrawalRequestSheet,
  type WithdrawalRecoveryHandle,
  type WithdrawalSheetView,
} from './WithdrawalRequestSheet';

type Props = {
  scope: WithdrawalScopeValue;
  transport: WithdrawalTransport;
  refreshKey?: number;
  requestHref?: (requestRef: string) => string;
  historyHref?: string;
  compactSummary?: boolean;
  summaryLayout?: 'card' | 'wide';
  children: (value: {
    renderSummary: (className: string) => ReactNode;
    persistenceWarning: string | null;
  }) => ReactNode;
};
const parseErrors: Record<AmountParseError, string> = {
  empty: 'กรุณาระบุจำนวนเงิน',
  format: 'กรุณาระบุจำนวนเงินให้ถูกต้อง',
  too_many_decimals: 'ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง',
  not_positive: 'จำนวนเงินต้องมากกว่าศูนย์',
  too_large: 'จำนวนเงินเกินขอบเขตที่ระบบรองรับ',
};
const freshReview = 'ข้อมูลหรือใบตรวจสอบเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่ก่อนยืนยัน';
const unsafeResponse = 'ตรวจสอบความถูกต้องของข้อมูลไม่ได้ กรุณาโหลดข้อมูลล่าสุด';
const emptyView = (): Extract<WithdrawalSheetView, { state: 'editing' }> => ({
  state: 'editing',
  mode: 'all',
  amountText: '',
  canReview: false,
});

/** Identity changes synchronously replace the entire interaction state, before paint.
 * Earnings filters are deliberately absent. Unmount fences responses; it never aborts money.
 */
export function WithdrawalExperience(props: Props) {
  return <ScopedExperience key={JSON.stringify(withdrawalScopeKey(props.scope))} {...props} />;
}

function ScopedExperience({
  scope,
  transport,
  refreshKey = 0,
  requestHref,
  historyHref,
  compactSummary,
  summaryLayout,
  children,
}: Props) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setViewState] = useState<WithdrawalSheetView>(emptyView);
  const viewRef = useRef(view);
  const setView = (next: WithdrawalSheetView) => {
    viewRef.current = next;
    setViewState(next);
  };
  const alive = useRef(true);
  const read = useRef<AbortController | null>(null);
  const operation = useRef(0);
  const submitLock = useRef(false);
  const recoveryLock = useRef(false);
  const command = useRef<WithdrawalSubmissionValue | null>(null);
  const quoteRevision = useRef<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [unsafe, setUnsafe] = useState(false);
  const query = useQuery({
    queryKey: withdrawalKeys.summary(scope),
    queryFn: ({ signal }) => loadWithdrawalSummary(transport, { scope, signal }),
    retry: false,
    staleTime: 0,
  });
  // Validation/identity errors must never fall back to old cached sensitive data.
  const unsafeRead = unsafe || query.error instanceof WithdrawalResponseError;
  const summary = unsafeRead ? null : query.data;
  const ready =
    !!summary && !query.isError && !query.isFetching && summary.readiness.requestGate === 'ready';
  const localAmbiguous = view.state === 'uncertain' || view.state === 'submitting';
  const remoteUncertain = !!summary?.resume.some((entry) => entry.status === 'reconciling');
  const canStartNew = ready && !localAmbiguous && !remoteUncertain && !recoveryLock.current;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current += 1;
      read.current?.abort();
    };
  }, []);

  async function refresh() {
    await client.cancelQueries({ queryKey: withdrawalScopeKey(scope) });
    await client.invalidateQueries({ queryKey: withdrawalScopeKey(scope) });
  }
  const previousRefresh = useRef(refreshKey);
  useEffect(() => {
    if (previousRefresh.current === refreshKey) return;
    previousRefresh.current = refreshKey;
    operation.current += 1;
    read.current?.abort();
    const current = viewRef.current;
    if (current.state === 'quoting') setView({ ...emptyView(), reasons: [freshReview] });
    else if (current.state === 'active') setView({ ...current, checkingKey: undefined });
    else if (current.state === 'result' || current.state === 'uncertain')
      setView({ ...current, checking: false });
    void refresh();
    // The preview invalidates only this financial scope, independently of earnings filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (query.isSuccess && !query.isFetching) setUnsafe(false);
  }, [query.dataUpdatedAt, query.isSuccess, query.isFetching]);
  useEffect(() => {
    if (!(query.error instanceof WithdrawalResponseError)) return;
    operation.current += 1;
    read.current?.abort();
    const current = viewRef.current;
    if (current.state === 'submitting') return;
    if (current.state === 'uncertain')
      setView({
        state: 'uncertain',
        handle: current.handle,
        canRecover: true,
        message: unsafeResponse,
      });
    else if (current.state === 'result')
      setView({
        state: 'uncertain',
        handle: {
          idempotencyKey: current.request.idempotencyKey,
          requestRef: current.request.requestRef,
        },
        canRecover: current.canRecover,
        message: unsafeResponse,
      });
    else setView({ ...emptyView(), reasons: [unsafeResponse] });
  }, [query.error]);

  const quote = view.state === 'review' ? view.quote : null;
  useEffect(() => {
    setExpired(false);
    if (!quote) return;
    const ms = Date.parse(quote.expiresAt) - Date.now();
    if (ms <= 0) {
      setExpired(true);
      return;
    }
    const timer = setTimeout(() => setExpired(true), Math.min(ms, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [quote]);
  const quoteCurrent =
    ready &&
    !remoteUncertain &&
    !expired &&
    quote !== null &&
    quoteRevision.current === summary?.revision &&
    summary?.balance.state === 'known' &&
    quote.bindings.balanceRevision === summary?.balance.revision &&
    quote.bindings.beneficiaryVersion === summary?.readiness.context.expectedVersions.beneficiary &&
    quote.bindings.policyRevision === summary?.readiness.context.expectedVersions.taxPolicy &&
    Date.now() < Date.parse(quote.expiresAt);

  function edit(mode?: 'all' | 'partial', amountText?: string) {
    if (submitLock.current || localAmbiguous || recoveryLock.current) return;
    operation.current += 1;
    read.current?.abort();
    const current = viewRef.current;
    const input = current.state === 'editing' || current.state === 'quoting' ? current : null;
    command.current = null;
    quoteRevision.current = null;
    setView({
      state: 'editing',
      mode: mode ?? input?.mode ?? 'all',
      amountText: amountText ?? input?.amountText ?? '',
      canReview: ready,
    });
  }

  async function review() {
    const current = viewRef.current;
    if (current.state !== 'editing' || !canStartNew || !summary) return;
    const parsed =
      current.mode === 'all' && summary.balance.state === 'known'
        ? { ok: true as const, minor: summary.balance.available.minor }
        : parseThbAmountToMinor(current.amountText);
    if (!parsed.ok) {
      setView({ ...current, fieldError: parseErrors[parsed.error] });
      return;
    }
    const generation = ++operation.current;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setView({ state: 'quoting', mode: current.mode, amountText: current.amountText });
    try {
      const result = await loadWithdrawalQuote(transport, {
        scope,
        grossMinor: parsed.minor,
        signal: controller.signal,
      });
      if (!alive.current || generation !== operation.current) return;
      if (result.state === 'unavailable') {
        const amountError =
          current.mode === 'partial' && result.codes.some((code) => code.startsWith('amount_'));
        setView({
          ...current,
          reasons: amountError ? undefined : result.reasons,
          fieldError: amountError ? result.reasons.join(' ') : undefined,
        });
        void refresh();
      } else if (
        summary.balance.state !== 'known' ||
        result.bindings.balanceRevision !== summary.balance.revision ||
        result.bindings.beneficiaryVersion !==
          summary.readiness.context.expectedVersions.beneficiary ||
        result.bindings.policyRevision !== summary.readiness.context.expectedVersions.taxPolicy
      ) {
        // The source can change BETWEEN the card read and the quote. Refresh the card, then
        // ask for a new review; repeatedly quoting against an old card would strand the form.
        setView({ ...current, reasons: [freshReview] });
        void refresh();
      } else {
        quoteRevision.current = summary.revision;
        setView({ state: 'review', quote: result, canConfirm: true });
      }
    } catch (error) {
      if (!alive.current || generation !== operation.current || controller.signal.aborted) return;
      if (error instanceof WithdrawalResponseError) setUnsafe(true);
      setView({
        ...current,
        reasons: [
          error instanceof WithdrawalResponseError
            ? unsafeResponse
            : 'ตรวจสอบรายการไม่สำเร็จ กรุณาลองอีกครั้ง',
        ],
      });
    }
  }

  function showRequest(request: WithdrawalRequestValue, unknown = false) {
    const canRecover = request.allowedActions.includes('check_status');
    setView(
      unknown || request.status === 'reconciling'
        ? {
            state: 'uncertain',
            handle: { idempotencyKey: request.idempotencyKey, requestRef: request.requestRef },
            request,
            canRecover,
          }
        : { state: 'result', request, canRecover },
    );
  }

  async function confirm() {
    const current = viewRef.current;
    if (submitLock.current || current.state !== 'review') return;
    if (!quoteCurrent || Date.now() >= Date.parse(current.quote.expiresAt)) {
      setView({ ...current, canConfirm: false, notice: freshReview });
      return;
    }
    // Set synchronously BEFORE any await or render: two same-tick clicks share one command.
    submitLock.current = true;
    const submission: WithdrawalSubmissionValue = structuredClone({
      scope,
      idempotencyKey: crypto.randomUUID(),
      quoteId: current.quote.quoteId,
      gross: current.quote.gross,
      net: current.quote.net,
      bindings: current.quote.bindings,
    });
    command.current = submission;
    setView({ state: 'submitting', quote: current.quote });
    // This signal is never aborted by close, filter changes, scope change or unmount.
    const signal = new AbortController().signal;
    try {
      const result = await submitWithdrawal(transport, { submission, signal });
      if (!alive.current) return;
      if (result.outcome === 'rejected') {
        if (result.code === 'quote_consumed' || result.code === 'idempotency_conflict') {
          setView({
            state: 'uncertain',
            handle: { idempotencyKey: submission.idempotencyKey },
            canRecover: true,
            message: 'ต้องตรวจสอบคำขอเดิมก่อนเริ่มรายการใหม่',
          });
        } else {
          command.current = null;
          setView({
            state: 'editing',
            mode: 'all',
            amountText: '',
            canReview: false,
            reasons: [result.detail, freshReview],
          });
        }
      } else showRequest(result.request, result.outcome === 'unknown');
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof WithdrawalResponseError) setUnsafe(true);
      setView({
        state: 'uncertain',
        handle: { idempotencyKey: submission.idempotencyKey },
        canRecover: true,
      });
    } finally {
      submitLock.current = false;
      if (alive.current) void refresh();
    }
  }

  async function recover(handle: WithdrawalRecoveryHandle) {
    if (recoveryLock.current || submitLock.current) return;
    const current = viewRef.current;
    const allowed =
      current.state === 'active'
        ? current.entries.some(
            (entry) =>
              entry.idempotencyKey === handle.idempotencyKey &&
              entry.allowedActions.includes('check_status'),
          )
        : (current.state === 'uncertain' || current.state === 'result') && current.canRecover;
    if (!allowed) return;
    recoveryLock.current = true;
    const generation = ++operation.current;
    const controller = new AbortController();
    read.current?.abort();
    read.current = controller;
    setView(
      current.state === 'active'
        ? { ...current, checkingKey: handle.idempotencyKey }
        : ({ ...current, checking: true } as WithdrawalSheetView),
    );
    try {
      const result = await recoverWithdrawal(transport, {
        scope,
        ...handle,
        signal: controller.signal,
      });
      if (!alive.current || generation !== operation.current) return;
      if (result.state === 'found') showRequest(result.request);
      else
        setView({
          state: 'uncertain',
          handle,
          canRecover: true,
          message: 'ยังไม่พบผลคำขอเดิม กรุณาตรวจสอบอีกครั้ง ไม่ต้องส่งคำขอใหม่',
        });
    } catch (error) {
      if (!alive.current || generation !== operation.current || controller.signal.aborted) return;
      if (error instanceof WithdrawalResponseError) {
        setUnsafe(true);
        setView({ state: 'uncertain', handle, canRecover: true, message: unsafeResponse });
      } else if (current.state === 'active')
        setView({
          ...current,
          checkingKey: undefined,
          message: 'ตรวจสอบสถานะไม่สำเร็จ กรุณาลองอีกครั้ง',
        });
      else
        setView({
          ...current,
          checking: false,
          message: 'ตรวจสอบสถานะไม่สำเร็จ กรุณาลองอีกครั้ง',
        } as WithdrawalSheetView);
    } finally {
      recoveryLock.current = false;
      if (alive.current) void refresh();
    }
  }

  function reopen() {
    const current = viewRef.current;
    if (!localAmbiguous && !recoveryLock.current && canStartNew) {
      edit('partial', '');
      setOpen(true);
      return;
    }
    if (
      !localAmbiguous &&
      !recoveryLock.current &&
      summary?.resume.length &&
      (current.state === 'editing' ||
        current.state === 'active' ||
        (current.state === 'result' && summary.resume.length > 1))
    ) {
      const entry =
        summary.resume.find((item) => item.status === 'reconciling') ?? summary.resume[0];
      setView({
        state: 'uncertain',
        handle: { idempotencyKey: entry.idempotencyKey, requestRef: entry.requestRef },
        canRecover: entry.allowedActions.includes('check_status'),
        message: 'ตรวจสอบรายการที่ยังดำเนินการก่อนถอนอีกครั้ง',
      });
    }
    setOpen(true);
  }
  let sheetView: WithdrawalSheetView =
    view.state === 'editing'
      ? { ...view, canReview: ready && !remoteUncertain }
      : view.state === 'review'
        ? {
            ...view,
            canConfirm: quoteCurrent && view.canConfirm,
            notice: !quoteCurrent ? freshReview : view.notice,
          }
        : view.state === 'active' && summary
          ? { ...view, entries: summary.resume }
          : view;
  // Render the quarantine immediately, including the render BEFORE effects clear local
  // snapshots. Keep only the original recovery identity when money may have been submitted.
  if (unsafeRead) {
    const handle =
      view.state === 'uncertain'
        ? view.handle
        : view.state === 'result'
          ? { idempotencyKey: view.request.idempotencyKey, requestRef: view.request.requestRef }
          : view.state === 'submitting' && command.current
            ? { idempotencyKey: command.current.idempotencyKey }
            : null;
    sheetView = handle
      ? { state: 'uncertain', handle, canRecover: !submitLock.current, message: unsafeResponse }
      : { ...emptyView(), reasons: [unsafeResponse] };
  }
  const hasRecovery = localAmbiguous || view.state === 'result' || !!summary?.resume.length;
  const state = query.isPending
    ? 'loading'
    : !summary
      ? 'error'
      : query.isError
        ? 'stale'
        : 'ready';
  return (
    <>
      {children({
        renderSummary: (className) => (
          <WithdrawalSummary
            compact={compactSummary}
            layout={summaryLayout}
            data={summary ?? null}
            state={state}
            className={className}
            onRetry={() => void refresh()}
            action={{
              kind: hasRecovery ? 'recovery' : 'request',
              label: 'ถอนเงิน',
              onClick: reopen,
              disabled: !hasRecovery && !ready,
            }}
          />
        ),
        persistenceWarning: summary?.persistenceWarning ?? null,
      })}
      <WithdrawalRequestSheet
        historyHref={historyHref}
        requestHref={requestHref}
        open={open}
        view={sheetView}
        available={summary?.balance.state === 'known' ? summary.balance.available : null}
        beneficiary={
          summary?.beneficiary ?? {
            state: 'missing',
            reasons: ['ยังไม่มีข้อมูลบัญชีรับเงินที่ตรวจสอบได้'],
          }
        }
        canStartNew={canStartNew}
        onClose={() => setOpen(false)}
        onModeChange={(mode) => edit(mode)}
        onAmountChange={(raw) => edit('partial', raw)}
        onEdit={() => edit()}
        onReview={() => void review()}
        onConfirm={() => void confirm()}
        onRecover={(handle) => void recover(handle)}
        onNewRequest={() => {
          if (canStartNew) edit();
        }}
      />
    </>
  );
}
