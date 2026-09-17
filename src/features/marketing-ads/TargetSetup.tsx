'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RegistrationScopeValue } from '@/contracts/ad-registration';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Field';
import { Text } from '@/shared/ui/Text';
import { DataState } from '@/shared/ui/DataState';
import { createTarget, loadTargetOptions } from './http';
import forms from '@/shared/ui/forms.module.css';
import styles from './marketing-ads.module.css';

/** Records the existing deal reference only. Rates and payout authority stay in finance. */
export function TargetSetup({ scope }: { scope: RegistrationScopeValue }) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>เพิ่มคลิปและดีลสำหรับเชื่อมแอด</summary>
      {open && <SetupForm key={JSON.stringify(scope)} scope={scope} />}
    </details>
  );
}
function SetupForm({ scope }: { scope: RegistrationScopeValue }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(''),
    [settledSearch, setSettledSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ['marketing-target-options', scope, settledSearch],
    queryFn: ({ signal }) => loadTargetOptions(scope, signal, settledSearch),
    retry: false,
  });
  const [selection, setSelection] = useState('');
  const [agreementId, setAgreementId] = useState(''),
    [label, setLabel] = useState(''),
    [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const key = useRef<string | null>(null),
    work = useRef<AbortController | null>(null);
  useEffect(() => () => work.current?.abort(), []);
  const clips = query.data?.clips ?? [];
  const selected = clips.find((c) => JSON.stringify([c.partnerId, c.clipId]) === selection);
  const edit = () => {
    key.current = null;
    setMessage('');
    setError('');
  };
  return (
    <Card title="คลิปในข้อตกลง">
      <Text tone="muted">
        เลือกคลิปที่มีในระบบ แล้วระบุดีลที่ตกลงไว้กับพาร์ทเนอร์
        การเพิ่มรายการนี้ไม่เปลี่ยนอัตราคอมมิชชัน
      </Text>
      <Field
        label="ค้นหาพาร์ทเนอร์หรือคลิป"
        type="search"
        disabled={busy}
        maxLength={160}
        value={search}
        onChange={(e) => {
          edit();
          setSelection('');
          setSearch(e.target.value);
        }}
      />
      {query.isPending && <DataState state="loading" />}
      {query.error && (
        <DataState
          state="error"
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && !query.error && (
        <form
          className={forms.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected || busy) return;
            key.current ??= crypto.randomUUID();
            const controller = new AbortController();
            work.current = controller;
            setBusy(true);
            setError('');
            setMessage('');
            try {
              const result = await createTarget(
                {
                  ...scope,
                  partnerId: selected.partnerId,
                  clipId: selected.clipId,
                  agreementId,
                  agreementLabel: label,
                  evidenceRef: evidence,
                  idempotencyKey: key.current,
                },
                controller.signal,
              );
              if (controller.signal.aborted) return;
              setMessage(
                result.replayed
                  ? 'คลิปนี้อยู่ในดีลแล้ว'
                  : 'เพิ่มคลิปในดีลแล้ว เลือกเชื่อมแอดได้ด้านล่าง',
              );
              await Promise.all([
                queryClient.invalidateQueries({
                  queryKey: ['staff', scope.actorId, scope.permissionRevision, 'ad-registration'],
                }),
                queryClient.invalidateQueries({
                  queryKey: ['staff-video', scope.actorId, scope.permissionRevision],
                }),
              ]);
            } catch (error) {
              if (!controller.signal.aborted)
                setError(error instanceof Error ? error.message : 'ยังเพิ่มรายการไม่สำเร็จ');
            } finally {
              if (!controller.signal.aborted) setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className={styles.fields}>
            {query.data.hasMore && (
              <Text>แสดง 100 รายการแรก พิมพ์ชื่อพาร์ทเนอร์หรือคลิปให้เฉพาะเจาะจงขึ้น</Text>
            )}
            <label className={forms.field}>
              คลิปของพาร์ทเนอร์
              <select
                required
                value={selection}
                onChange={(e) => {
                  edit();
                  setSelection(e.target.value);
                }}
              >
                <option value="">เลือกคลิป</option>
                {clips.map((c) => (
                  <option
                    key={JSON.stringify([c.partnerId, c.clipId])}
                    value={JSON.stringify([c.partnerId, c.clipId])}
                  >
                    {c.partnerName} · {c.title}
                  </option>
                ))}
              </select>
            </label>
            {!clips.length && (
              <Text>ยังไม่มีคลิป กรุณาเพิ่มข้อมูลคลิปของพาร์ทเนอร์เข้าระบบก่อน</Text>
            )}
            <div className={forms.grid}>
              <Field
                label="รหัสดีลที่ตกลงแล้ว"
                required
                maxLength={160}
                value={agreementId}
                onChange={(e) => {
                  edit();
                  setAgreementId(e.target.value);
                }}
              />
              <Field
                label="ชื่อดีล"
                required
                maxLength={160}
                value={label}
                onChange={(e) => {
                  edit();
                  setLabel(e.target.value);
                }}
              />
            </div>
            <Field
              label="เอกสารหรือเลขอ้างอิงข้อตกลง"
              required
              maxLength={500}
              value={evidence}
              onChange={(e) => {
                edit();
                setEvidence(e.target.value);
              }}
            />
            <Button type="submit" disabled={!selected || busy}>
              {busy ? 'กำลังเพิ่ม…' : 'เพิ่มคลิปในดีล'}
            </Button>
          </fieldset>
        </form>
      )}
      {error && <Text role="alert">{error}</Text>}
      {message && <Text role="status">{message}</Text>}
    </Card>
  );
}
