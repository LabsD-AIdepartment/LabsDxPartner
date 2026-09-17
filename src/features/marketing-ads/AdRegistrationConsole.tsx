'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AdDraftValue,
  AdPlatformValue,
  AdRegistrationValue,
  RegistrationScopeValue,
  ResolvedAdValue,
} from '@/contracts/ad-registration';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Field';
import { Text } from '@/shared/ui/Text';
import { CoverImage } from '@/shared/ui/CoverImage';
import { DataState } from '@/shared/ui/DataState';
import { timestamp } from '@/shared/ui/format-date';
import { registrationIssue } from '@/contracts/ad-registration';
import {
  platformLabels,
  syncLabels,
  RegistrationError,
  readRegistration,
  resolveRegistration,
  saveRegistration,
  sameDraft,
  type AdRegistrationTransport,
} from './model';
import forms from '@/shared/ui/forms.module.css';
import styles from './marketing-ads.module.css';

type Props = {
  scope: RegistrationScopeValue;
  transport: AdRegistrationTransport;
  initialTargetId?: string;
};
export function AdRegistrationConsole(props: Props) {
  return <Console key={JSON.stringify(props.scope)} {...props} />;
}
function Console({ scope, transport, initialTargetId }: Props) {
  const query = useQuery({
    queryKey: ['staff', scope.actorId, scope.permissionRevision, 'ad-registration'],
    queryFn: ({ signal }) => readRegistration(transport, scope, signal),
    refetchInterval: (query) => query.state.data?.sourceMode === 'native' ? 15_000 : 2_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return (
    <div className={forms.stack}>
      <Text tone="muted">
        เลือกคลิป กรอก Ad ID และเชื่อมครั้งเดียว ระบบจะติดตามข้อมูลให้โดยอัตโนมัติ
      </Text>
      {query.isPending && <DataState state="loading" />}
      {query.error && (
        <DataState
          state="error"
          message={
            query.error instanceof RegistrationError
              ? query.error.message
              : 'โหลดข้อมูลการเชื่อมต่อไม่สำเร็จ'
          }
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && !query.error && (
        <Workspace
          value={query.data}
          scope={scope}
          transport={transport}
          initialTargetId={initialTargetId}
          reload={() => query.refetch()}
        />
      )}
    </div>
  );
}
function Workspace({
  value,
  scope,
  transport,
  initialTargetId,
  reload,
}: Props & { value: AdRegistrationValue; reload: () => Promise<unknown> }) {
  const [targetId, setTargetId] = useState(initialTargetId ?? '');
  const [platform, setPlatform] = useState<AdPlatformValue>(
    () =>
      value.connections.find((row) => !registrationIssue(row, value.sourceMode))?.platform ??
      value.connections[0]?.platform ??
      'facebook',
  );
  const [connectionId, setConnectionId] = useState('');
  const [externalId, setExternalId] = useState('');
  const [resolved, setResolved] = useState<ResolvedAdValue | null>(null);
  const [busy, setBusy] = useState<'resolve' | 'save' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const work = useRef<{ version: number; controller?: AbortController }>({ version: 0 });
  useEffect(
    () => () => {
      work.current.version++;
      work.current.controller?.abort();
    },
    [],
  );
  const selectableTargets = value.targets.filter((row) => row.available);
  const target = targetId ? selectableTargets.find((row) => row.id === targetId) : selectableTargets[0];
  const connections = value.connections.filter((row) => row.platform === platform);
  const connection = connectionId
    ? connections.find((row) => row.id === connectionId)
    : (connections.find((row) => !registrationIssue(row, value.sourceMode)) ?? connections[0]);
  const connectionIssue = connection ? registrationIssue(connection, value.sourceMode) : null;
  const platforms = Array.from(new Set(value.connections.map((row) => row.platform)));
  const partners = Array.from(
    new Map(selectableTargets.map((row) => [row.partnerId, row.partnerName])),
  );
  const draft: AdDraftValue = {
    targetId: target?.id ?? '',
    platform,
    connectionId: connection?.id ?? '',
    externalId: externalId.trim(),
  };
  const edit = (update: () => void) => {
    work.current.version++;
    work.current.controller?.abort();
    setBusy(null);
    setResolved(null);
    setError('');
    setMessage('');
    update();
  };
  const run = async (kind: 'resolve' | 'save') => {
    work.current.controller?.abort();
    const version = ++work.current.version;
    const controller = new AbortController();
    work.current.controller = controller;
    setBusy(kind);
    setError('');
    setMessage('');
    if (kind === 'resolve') setResolved(null);
    try {
      if (kind === 'resolve') {
        const result = await resolveRegistration(transport, scope, value, draft, controller.signal);
        if (version === work.current.version) setResolved(result);
      } else if (resolved) {
        const result = await saveRegistration(
          transport,
          scope,
          value,
          resolved,
          draft,
          controller.signal,
        );
        if (version !== work.current.version) return;
        setResolved(null);
        setMessage(
          result.replayed
            ? 'แอดนี้เชื่อมกับคลิปนี้ไว้แล้ว ไม่มีการบันทึกซ้ำ'
            : 'เชื่อมแอดแล้ว ติดตามสถานะได้ด้านล่าง',
        );
        await reload();
      }
    } catch (error) {
      if (version === work.current.version && !controller.signal.aborted)
        setError(
          error instanceof RegistrationError ? error.message : 'ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง',
        );
    } finally {
      if (version === work.current.version) setBusy(null);
    }
  };
  const canResolve =
    value.canManage && !!target && !!connection && !connectionIssue && !!draft.externalId;
  return (
    <>
      {!value.canManage && (
        <DataState state="unavailable" message="บัญชีนี้ดูรายการได้ แต่ไม่มีสิทธิ์เชื่อมแอด" />
      )}
      <Card title="เชื่อมแอดกับคลิป">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run('resolve');
          }}
          className={forms.form}
        >
          <fieldset className={styles.fields} disabled={busy === 'save' || !value.canManage}>
            <div className={forms.grid}>
              <label className={forms.field}>
                พาร์ทเนอร์
                <select
                  value={target?.partnerId ?? ''}
                  onChange={(event) =>
                    edit(() =>
                      setTargetId(
                        selectableTargets.find((row) => row.partnerId === event.target.value)?.id ?? '',
                      ),
                    )
                  }
                >
                  {!target && <option value="">เลือกพาร์ทเนอร์</option>}
                  {partners.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={forms.field}>
                คลิปและข้อตกลง
                <select
                  value={target?.id ?? ''}
                  onChange={(event) => edit(() => setTargetId(event.target.value))}
                >
                  {!target && <option value="">เลือกคลิป</option>}
                  {selectableTargets
                    .filter((row) => row.partnerId === target?.partnerId)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.clipTitle} · {row.agreementLabel}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {target ? (
              <div className={styles.target}>
                <CoverImage src={target.cover} alt="" />
                <div>
                  <Text as="strong">{target.clipTitle}</Text>
                  <Text variant="caption" tone="muted">
                    {target.agreementLabel}
                  </Text>
                </div>
              </div>
            ) : (
              <Text role="alert">ไม่พบคลิปในสิทธิ์ของคุณ กรุณาเลือกพาร์ทเนอร์และคลิปใหม่</Text>
            )}
            <div className={forms.grid}>
              <label className={forms.field}>
                แพลตฟอร์ม
                <select
                  value={platform}
                  onChange={(event) =>
                    edit(() => {
                      setPlatform(event.target.value as AdPlatformValue);
                      setConnectionId('');
                    })
                  }
                >
                  {platforms.length === 0 && (
                    <option value="">ยังไม่มีแพลตฟอร์มที่เชื่อมต่อ</option>
                  )}
                  {platforms.map((id) => (
                    <option key={id} value={id}>
                      {platformLabels[id]}
                    </option>
                  ))}
                </select>
              </label>
              {connections.length > 1 ? (
                <label className={forms.field}>
                  บัญชีโฆษณาหรือร้านค้า
                  <select
                    value={connection?.id ?? ''}
                    onChange={(event) => edit(() => setConnectionId(event.target.value))}
                  >
                    {!connection && <option value="">เลือกบัญชี</option>}
                    {connections.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className={forms.field}>
                  <Text as="span">บัญชีโฆษณาหรือร้านค้า</Text>
                  <Text as="strong">{connection?.label ?? 'ยังไม่มีบัญชีที่พร้อมใช้งาน'}</Text>
                </div>
              )}
            </div>
            {connectionIssue && <Text role="alert">{connectionIssue}</Text>}
            {!connection && (
              <Text role="alert">ติดต่อผู้ดูแลเพื่อเชื่อมบัญชีที่รองรับแพลตฟอร์มนี้</Text>
            )}
            <div className={styles.lookup}>
              <Field
                label="Ad ID"
                placeholder="วางรหัสแอดที่ต้องการเชื่อม"
                required
                maxLength={160}
                value={externalId}
                onChange={(event) => edit(() => setExternalId(event.target.value))}
                autoComplete="off"
              />
              <Button type="submit" disabled={!canResolve || busy !== null}>
                {busy === 'resolve' ? 'กำลังค้นหาแอด…' : 'ค้นหาแอด'}
              </Button>
            </div>
          </fieldset>
        </form>
        {error && (
          <Text role="alert" className={styles.feedback}>
            {error}
          </Text>
        )}
        {message && (
          <Text role="status" className={styles.feedback}>
            {message}
          </Text>
        )}
        {resolved && !connectionIssue && sameDraft(resolved.draft, draft) && (
          <section className={styles.resolved} aria-label="แอดที่ค้นพบ">
            <CoverImage src={resolved.cover} alt="ภาพชิ้นงานโฆษณาที่ต้นทางส่งมา" />
            <div className={styles.resultBody}>
              <Text as="h2" variant="cardTitle">
                {resolved.name}
              </Text>
              <Text tone="muted">
                {platformLabels[resolved.draft.platform]} · {connection?.label}
              </Text>
              <dl className={styles.facts}>
                <div>
                  <dt>Ad ID</dt>
                  <dd>{resolved.draft.externalId}</dd>
                </div>
                <div>
                  <dt>บัญชีต้นทาง</dt>
                  <dd>{resolved.accountId}</dd>
                </div>
                <div>
                  <dt>ชิ้นงาน</dt>
                  <dd>{resolved.creativeId}</dd>
                </div>
                <div>
                  <dt>สถานะแอด</dt>
                  <dd>
                    {
                      {
                        active: 'กำลังแสดง',
                        paused: 'หยุดชั่วคราว',
                        removed: 'ถูกนำออกแล้ว',
                        unknown: 'ไม่ทราบสถานะ',
                      }[resolved.delivery]
                    }
                  </dd>
                </div>
              </dl>
              <Text variant="caption" tone="muted">
                ตรวจว่าชิ้นงานนี้ตรงกับคลิปที่เลือก
                การเชื่อมแอดไม่เปลี่ยนยอดคอมมิชชันหรือยืนยันการจ่ายเงิน
              </Text>
              <Button
                variant="primary"
                disabled={busy !== null || !value.canManage}
                onClick={() => void run('save')}
              >
                {busy === 'save' ? 'กำลังเชื่อม…' : 'เชื่อมแอดนี้กับคลิป'}
              </Button>
            </div>
          </section>
        )}
      </Card>
      <Card title={`แอดที่เชื่อมแล้ว (${value.associations.length})`}>
        {value.associations.length === 0 ? (
          <Text tone="muted">ยังไม่มีแอดที่เชื่อม เริ่มด้วย Ad ID แรกด้านบน</Text>
        ) : (
          <div className={styles.list}>
            {value.associations.map((row) => (
              <article key={row.id} className={styles.association}>
                <div>
                  <Text as="h3" variant="cardTitle">
                    {row.name}
                  </Text>
                  <Text tone="muted">
                    {platformLabels[row.connection.platform]} · {row.connection.label}
                  </Text>
                  <Text>
                    {row.target.partnerName} · {row.target.clipTitle}
                  </Text>
                  <Text variant="caption" tone="muted">
                    Ad ID {row.externalId} · {row.target.agreementLabel}
                  </Text>
                </div>
                <div className={styles.sync} role="status">
                  <Text as="strong">{syncLabels[row.sync]}</Text>
                  {row.issue && <Text>{row.issue}</Text>}
                  <Text variant="caption" tone="muted">
                    ดึงสำเร็จล่าสุด:{' '}
                    {row.lastSuccessAt ? timestamp(row.lastSuccessAt) : 'ยังไม่มีข้อมูล'}
                  </Text>
                  {row.dataThrough && (
                    <Text variant="caption" tone="muted">
                      ข้อมูลต้นทางถึง: {timestamp(row.dataThrough)}
                    </Text>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
