'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  ConnectionsSnapshot,
  ConnectionCommand,
  ConnectionResult,
} from '@/contracts/marketing-connections';
import type { RegistrationScopeValue } from '@/contracts/ad-registration';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Text } from '@/shared/ui/Text';
import { DataState } from '@/shared/ui/DataState';
import { ImportActivityQuery, ImportActivitySnapshot } from '@/contracts/import-activity';
import { ImportActivity } from './ImportActivity';
import forms from '@/shared/ui/forms.module.css';
import styles from './marketing-ads.module.css';
export type ConnectionTransport = {
  activity?: (scope: z.infer<typeof ImportActivityQuery>, signal: AbortSignal) => Promise<unknown>;
  read: (scope: RegistrationScopeValue, signal: AbortSignal) => Promise<unknown>;
  command: (command: z.infer<typeof ConnectionCommand>, signal: AbortSignal) => Promise<unknown>;
};
export function ConnectionsPanel({
  scope,
  transport,
  platform = 'facebook',
}: {
  scope: RegistrationScopeValue;
  transport: ConnectionTransport;
  platform?: 'facebook' | 'tiktok';
}) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {platform === 'tiktok' ? 'ร้าน TikTok Shop และสถานะนำเข้า' : 'การเชื่อมต่อและสถานะนำเข้า'}
      </summary>
      {open && (
        <ConnectionList
          key={platform + JSON.stringify(scope)}
          scope={scope}
          transport={transport}
          platform={platform}
        />
      )}
    </details>
  );
}
function ConnectionList({
  scope,
  transport,
  platform,
}: {
  scope: RegistrationScopeValue;
  transport: ConnectionTransport;
  platform: 'facebook' | 'tiktok';
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const work = useRef<AbortController | null>(null),
    key = useRef<{ intent: string; id: string } | null>(null);
  useEffect(() => () => work.current?.abort(), []);
  const query = useQuery({
    queryKey: ['marketing-connections', platform, scope],
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const data = ConnectionsSnapshot.parse(await transport.read(scope, signal));
      if (data.actorId !== scope.actorId || data.permissionRevision !== scope.permissionRevision)
        throw new Error('สิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง');
      if (data.connections.some((c) => c.platform !== platform))
        throw new Error('ข้อมูลการเชื่อมต่อไม่ตรงกับแพลตฟอร์ม');
      return data;
    },
  });
  const activity = useQuery({
    queryKey: ['marketing-import-activity', platform, scope],
    enabled: !!transport.activity,
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const data = ImportActivitySnapshot.parse(
        await transport.activity!({ ...scope, platform }, signal),
      );
      signal.throwIfAborted();
      if (
        data.actorId !== scope.actorId ||
        data.permissionRevision !== scope.permissionRevision ||
        data.platform !== platform
      )
        throw new Error('สถานะคิวไม่ตรงกับสิทธิ์ปัจจุบัน');
      return data;
    },
  });
  const run = async (
    c: z.infer<typeof ConnectionsSnapshot>['connections'][number],
    action: z.infer<typeof ConnectionCommand>['action'],
  ) => {
    if (busy) return;
    const intent = JSON.stringify([c.id, c.revision, action]);
    if (key.current?.intent !== intent) key.current = { intent, id: crypto.randomUUID() };
    const controller = new AbortController();
    work.current = controller;
    setBusy(c.id);
    setMessage('');
    setError('');
    try {
      const result = ConnectionResult.parse(
        await transport.command(
          {
            ...scope,
            connectionId: c.id,
            revision: c.revision,
            action,
            idempotencyKey: key.current.id,
          },
          controller.signal,
        ),
      );
      if (controller.signal.aborted) return;
      if (result.connectionId !== c.id) throw new Error('ผลการบันทึกไม่ตรงกับบัญชีที่เลือก');
      setMessage(
        action === 'verify'
          ? 'ตรวจสอบสำเร็จ เปิดรับข้อมูลอัตโนมัติแล้ว'
          : action === 'pause'
            ? 'พักการรับข้อมูลแล้ว เก็บรายงานเดิมไว้'
            : 'นำงานที่ผิดพลาดกลับเข้าคิวแล้ว ระบบจะรอตามโควตาของต้นทาง',
      );
      key.current = null;
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'ยังดำเนินการไม่สำเร็จ');
    } finally {
      if (!controller.signal.aborted) {
        setBusy(null);
        await query.refetch();
        if (transport.activity) await activity.refetch();
        await client.invalidateQueries({
          queryKey: ['staff', scope.actorId, scope.permissionRevision, 'ad-registration'],
        });
        if (platform === 'tiktok')
          await client.invalidateQueries({
            queryKey: ['staff-video', scope.actorId, scope.permissionRevision],
          });
      }
    }
  };
  return (
    <Card title={platform === 'tiktok' ? 'ร้าน TikTok Shop ที่เชื่อมต่อ' : 'บัญชีที่เชื่อมต่อ'}>
      <Text tone="muted">
        ตั้งค่าครั้งเดียว แล้วระบบติดตามข้อมูลให้ ทีมเข้ามาจัดการเมื่อการเชื่อมต่อมีปัญหา
      </Text>
      {query.isPending && <DataState state="loading" />}
      {query.error && (
        <DataState
          state="error"
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && !query.error && (
        <div className={styles.list}>
          {!query.data.connections.length && (
            <Text>ยังไม่มีบัญชีที่คุณได้รับสิทธิ์ ให้ผู้ดูแลเพิ่มบัญชีและสิทธิ์ของทีมก่อน</Text>
          )}
          {query.data.connections.map((c) => (
            <section key={c.id} className={styles.association} aria-label={c.label}>
              <div>
                <Text as="h3">{c.label}</Text>
                <Text tone="muted">
                  {platform === 'tiktok' ? 'TikTok Shop' : 'Facebook'} · {c.accountId}
                </Text>
                <Text>
                  {c.enabled
                    ? 'เปิดรับข้อมูล'
                    : c.verifiedAt
                      ? 'พักการรับข้อมูล'
                      : 'ยังไม่ได้ยืนยันการเชื่อมต่อ'}{' '}
                  · {c.jobs} {platform === 'tiktok' ? 'ช่วงรายงานที่ติดตาม' : 'แอดที่ติดตาม'}
                  {c.attention > 0 ? ` · ต้องตรวจสอบ ${c.attention} รายการ` : ''}
                </Text>
                {c.verifiedAt && (
                  <Text tone="muted">
                    ตรวจสอบการเชื่อมต่อล่าสุด {new Date(c.verifiedAt).toLocaleString('th-TH')}
                  </Text>
                )}
                {c.lastSuccessAt && (
                  <Text tone="muted">
                    นำเข้าสำเร็จล่าสุด {new Date(c.lastSuccessAt).toLocaleString('th-TH')}
                  </Text>
                )}
                {transport.activity && (
                  <ImportActivity
                    snapshot={activity.data}
                    connectionId={c.id}
                    revision={c.revision}
                    unavailable={!!activity.error}
                  />
                )}
                {!c.configured && <Text>ผู้ดูแลต้องตั้งค่าการเชื่อมต่อฝั่งระบบก่อน</Text>}
              </div>
              <div className={styles.sync}>
                <div className={forms.actions}>
                  <Button disabled={!!busy || !c.configured} onClick={() => void run(c, 'verify')}>
                    {busy === c.id
                      ? 'กำลังดำเนินการ…'
                      : c.enabled
                        ? 'ตรวจการเชื่อมต่อ'
                        : 'ตรวจสอบและเปิดรับข้อมูล'}
                  </Button>
                  {c.enabled && (
                    <Button disabled={!!busy} onClick={() => void run(c, 'pause')}>
                      พักการรับข้อมูล
                    </Button>
                  )}
                  {c.enabled && (c.retryable ?? c.attention) > 0 && (
                    <Button disabled={!!busy} onClick={() => void run(c, 'retry')}>
                      ลองงานที่ผิดพลาดใหม่
                    </Button>
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      {error && <Text role="alert">{error}</Text>}
      {message && <Text role="status">{message}</Text>}
    </Card>
  );
}
const nativeActivity: NonNullable<ConnectionTransport['activity']> = (scope, signal) =>
  request('/api/v1/staff/import-activity', '?' + new URLSearchParams(scope), signal);
export const nativeConnectionTransport: ConnectionTransport = {
  activity: nativeActivity,
  read: (scope, signal) =>
    request('/api/v1/staff/ads/connections', '?' + new URLSearchParams(scope), signal),
  command: (command, signal) => request('/api/v1/staff/ads/connections', '', signal, command),
};
export const nativeVideoConnectionTransport: ConnectionTransport = {
  activity: nativeActivity,
  read: (scope, signal) =>
    request('/api/v1/staff/shop-videos/connections', '?' + new URLSearchParams(scope), signal),
  command: (command, signal) =>
    request('/api/v1/staff/shop-videos/connections', '', signal, command),
};
async function request(path: string, query: string, signal: AbortSignal, command?: unknown) {
  const response = await fetch(path + query, {
    method: command ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(command
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) }
      : {}),
  });
  const data = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const messages: Record<string, string> = {
      fresh_auth_required: 'กรุณายืนยันตัวตนเจ้าหน้าที่อีกครั้ง',
      throttled: 'ต้นทางขอให้พักการดึงข้อมูล ระบบจะรอตามโควตาก่อนลองใหม่',
      access: 'สิทธิ์ของบัญชีต้นทางไม่พร้อม ให้ผู้ดูแลตรวจการเชื่อมต่อ',
      conflict: 'ข้อมูลหรือสิทธิ์เปลี่ยน กรุณาตรวจรายการล่าสุดก่อนลองใหม่',
      'invalid-source': 'ข้อมูลบัญชีต้นทางไม่ตรงกับการตั้งค่า ให้ผู้ดูแลตรวจบัญชี',
    };
    throw new Error(
      messages[String(data?.code)] ??
        (response.status === 401 || response.status === 403
          ? 'สิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง'
          : 'ยังติดต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง'),
    );
  }
  return data;
}
