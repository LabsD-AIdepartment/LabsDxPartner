'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PayoutBeneficiaryConfigValue,
  SetPayoutBeneficiaryCommandValue,
  WithdrawalScopeValue,
} from '@/contracts/withdrawal-journey';
import { PayoutBeneficiaryPanel, type PayoutBeneficiaryDraft } from './PayoutBeneficiaryPanel';
import {
  loadPayoutBeneficiaryConfig,
  setPayoutBeneficiary,
  withdrawalKeys,
  withdrawalScopeKey,
  WithdrawalResponseError,
  type WithdrawalBeneficiaryTransport,
} from './model';

export type PayoutBeneficiaryExperienceProps = {
  scope: WithdrawalScopeValue;
  transport: WithdrawalBeneficiaryTransport;
  refreshKey?: string | number;
  /** Caller authority lifetime: a reset must clear drafts even when revisions collide. */
  resetKey?: string | number;
  compact?: boolean;
  action?: ReactNode;
};
type Review = { config: PayoutBeneficiaryConfigValue; draft: PayoutBeneficiaryDraft };
type Operation = {
  command: SetPayoutBeneficiaryCommandValue;
  state: 'saving' | 'unknown' | 'checked' | 'resolved';
  message: string;
};
const unknownMessage = 'ยังยืนยันผลการบันทึกไม่ได้ โปรดตรวจสอบข้อมูลปัจจุบันก่อนแก้ไขใหม่';
function reviewOf(config: PayoutBeneficiaryConfigValue): Review {
  return {
    config,
    draft: {
      displayName: config.displayName ?? '',
      bankId: config.bankId ?? '',
      accountChoiceId: config.accountChoiceId ?? '',
    },
  };
}
export function PayoutBeneficiaryExperience(props: PayoutBeneficiaryExperienceProps) {
  // Transport replacement is an authority change; ordinary version notifications preserve the form.
  const identity = useRef({ transport: props.transport, generation: 0 });
  if (identity.current.transport !== props.transport)
    identity.current = { transport: props.transport, generation: identity.current.generation + 1 };
  return (
    <ScopedBeneficiary
      key={JSON.stringify([
        ...withdrawalScopeKey(props.scope),
        props.resetKey ?? 0,
        identity.current.generation,
      ])}
      {...props}
    />
  );
}
function ScopedBeneficiary({
  scope,
  transport,
  refreshKey = 0,
  compact,
  action,
}: PayoutBeneficiaryExperienceProps) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: withdrawalKeys.beneficiary(scope, String(refreshKey)),
    queryFn: ({ signal }) => loadPayoutBeneficiaryConfig(transport, { scope, signal }),
    retry: false,
    staleTime: 0,
  });
  const [review, setReview] = useState<Review | null>(null);
  const [open, setOpen] = useState(false);
  const [operation, setOperationState] = useState<Operation | null>(null);
  const operationRef = useRef<Operation | null>(null);
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);
  const alive = useRef(true);
  const lock = useRef(false);
  const read = useRef<AbortController | null>(null);
  const readGeneration = useRef(0);
  const latestVersion = useRef(refreshKey);
  // Synchronously invalidate an in-flight check if an authoritative notification arrives.
  if (latestVersion.current !== refreshKey) {
    latestVersion.current = refreshKey;
    readGeneration.current += 1;
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      read.current?.abort();
    };
  }, []);
  const setOperation = (value: Operation | null) => {
    operationRef.current = value;
    setOperationState(value);
  };
  const config = !query.isError ? (query.data ?? null) : null;
  const fresh = query.isSuccess && !query.isFetching && config?.state !== 'unavailable';
  const changed = !!review && !!config && review.config.revision !== config.revision;
  const uncertain = operation?.state === 'unknown';
  const busy = operation?.state === 'saving';
  const canEdit = fresh && config?.allowedEdit && !busy && !uncertain;
  const canSave = !!(open && review && canEdit && !changed);
  const beginEdit = () => {
    if (!canEdit || !config) return;
    setReview(reviewOf(config));
    setError(undefined);
    setOperation(null);
    setOpen(true);
  };
  const refresh = () => {
    void query.refetch();
  };
  const checkCurrent = async () => {
    if (read.current || operationRef.current?.state !== 'unknown') return;
    const controller = new AbortController();
    read.current = controller;
    const generation = ++readGeneration.current;
    setChecking(true);
    try {
      const current = await loadPayoutBeneficiaryConfig(transport, {
        scope,
        signal: controller.signal,
      });
      if (!alive.current || generation !== readGeneration.current) return;
      client.setQueryData(
        withdrawalKeys.beneficiary(scope, String(latestVersion.current)),
        current,
      );
      if (current.state !== 'unavailable') {
        const previous = operationRef.current;
        if (previous)
          setOperation({
            ...previous,
            state: 'checked',
            message:
              'ตรวจสอบข้อมูลปัจจุบันแล้ว ข้อมูลที่แสดงไม่ใช่การยืนยันผลการบันทึกครั้งก่อน สามารถเปิดตรวจทานเพื่อแก้ไขใหม่ได้',
          });
        setOpen(false);
        setReview(null);
      }
    } catch {
      /* Keep uncertainty; the regular read supplies the visible error state. */
      if (alive.current && generation === readGeneration.current) void query.refetch();
    } finally {
      if (alive.current && read.current === controller) {
        read.current = null;
        setChecking(false);
      }
    }
  };
  const save = async () => {
    if (lock.current || !canSave || !review || operationRef.current?.state === 'unknown') return;
    const draft = review.draft;
    if (
      !draft.displayName.trim() ||
      !review.config.catalog.banks.some((b) => b.bankId === draft.bankId) ||
      !review.config.catalog.accounts.some((a) => a.accountChoiceId === draft.accountChoiceId)
    ) {
      setError('กรุณาระบุชื่อและเลือกธนาคารกับบัญชีตัวอย่างให้ครบ');
      return;
    }
    lock.current = true;
    const command: SetPayoutBeneficiaryCommandValue = {
      scope: { ...scope },
      expectedRevision: review.config.revision,
      idempotencyKey: crypto.randomUUID(),
      displayName: draft.displayName.trim(),
      bankId: draft.bankId,
      accountChoiceId: draft.accountChoiceId,
    };
    setError(undefined);
    setOperation({ command, state: 'saving', message: 'กำลังบันทึกบัญชีรับเงินตัวอย่าง…' });
    try {
      // A dispatched command belongs to the authority; unmount only fences its UI result.
      const result = await setPayoutBeneficiary(transport, {
        command,
        signal: new AbortController().signal,
      });
      if (!alive.current) return;
      if (result.outcome === 'saved') {
        setOperation({
          command,
          state: 'resolved',
          message: 'บันทึกบัญชีรับเงินตัวอย่างแล้ว โปรดดูสถานะปัจจุบัน',
        });
        setOpen(false);
        setReview(null);
      } else if (result.outcome === 'unknown')
        setOperation({ command, state: 'unknown', message: unknownMessage });
      else {
        setOperation({
          command,
          state: 'resolved',
          message:
            result.code === 'stale_revision'
              ? 'ข้อมูลบัญชีรับเงินเปลี่ยนแล้ว โปรดตรวจสอบข้อมูลล่าสุดก่อนบันทึก'
              : 'ไม่สามารถบันทึกบัญชีรับเงินได้ โปรดตรวจสอบข้อมูลปัจจุบันก่อนแก้ไขใหม่',
        });
        setOpen(false);
        setReview(null);
      }
    } catch {
      if (alive.current) setOperation({ command, state: 'unknown', message: unknownMessage });
    } finally {
      if (alive.current) {
        lock.current = false;
        void client.invalidateQueries({ queryKey: withdrawalScopeKey(scope) });
      }
    }
  };
  const state =
    query.error instanceof WithdrawalResponseError
      ? 'invalid'
      : query.isError
        ? 'read-error'
        : query.isFetching
          ? config
            ? 'stale'
            : 'loading'
          : config
            ? 'ready'
            : 'unavailable';
  return (
    <PayoutBeneficiaryPanel
      config={config}
      state={state}
      compact={compact}
      action={action}
      onRetry={refresh}
      onEdit={canEdit ? beginEdit : undefined}
      notice={operation?.message}
      uncertain={uncertain}
      checking={checking}
      onCheckCurrent={() => void checkCurrent()}
      editor={
        review
          ? {
              open,
              draft: review.draft,
              catalog: review.config.catalog,
              busy,
              canSave,
              changed,
              error,
              onChange: (draft) => setReview({ ...review, draft }),
              onClose: () => setOpen(false),
              onSave: () => void save(),
              onReviewLatest:
                canEdit && config
                  ? () => {
                      setReview(reviewOf(config));
                      setError(undefined);
                    }
                  : undefined,
            }
          : undefined
      }
    />
  );
}
