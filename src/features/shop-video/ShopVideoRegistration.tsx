'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import { ShopVideoSave, type ShopVideoReceipt } from '@/contracts/shop-video';
import type { RegistrationScopeValue } from '@/contracts/ad-registration';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import { Text } from '@/shared/ui/Text';
import { TextGroup } from '@/shared/ui/TextGroup';
import { DataState } from '@/shared/ui/DataState';
import {
  loadVideoOptions,
  lookupVideo,
  saveVideo,
  type VideoRegistrationTransport,
  VideoRequestError,
} from './transport';
import forms from '@/shared/ui/forms.module.css';
function unavailableOptions(error: unknown) {
  return error instanceof VideoRequestError && [401, 403, 404].includes(error.status);
}
export function ShopVideoRegistration({
  scope,
  transport,
}: {
  scope: RegistrationScopeValue;
  transport: VideoRegistrationTransport;
}) {
  const [search, setSearch] = useState(''),
    [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const options = useQuery({
    queryKey: ['staff-video', scope.actorId, scope.permissionRevision, searchQuery],
    queryFn: ({ signal }) => loadVideoOptions(transport, { ...scope, q: searchQuery }, signal),
    retry: false,
    refetchInterval: (query) => (unavailableOptions(query.state.error) ? false : 60_000),
  });
  const [targetId, setTarget] = useState(''),
    [connectionId, setConnection] = useState(''),
    [videoId, setVideo] = useState('');
  const [proof, setProof] = useState<z.infer<typeof ShopVideoReceipt> | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null),
    key = useRef('');
  const activeScope = scope.actorId + ':' + scope.permissionRevision;
  useEffect(() => () => controller.current?.abort(), [activeScope]);
  function edit() {
    controller.current?.abort();
    setProof(null);
    setMessage('');
    setBusy(false);
    key.current = '';
  }
  const target = options.data?.targets.find((t) => t.id === targetId);
  const connection = options.data?.connections.find((c) => c.id === connectionId);
  const searching = search.trim() !== searchQuery || options.isPending;
  const optionsStatus = options.error instanceof VideoRequestError ? options.error.status : null;
  const accessFailure = optionsStatus === 401 || optionsStatus === 403;
  const disabledIntegration = optionsStatus === 404;
  const validProof =
    proof &&
    proof.actorId === scope.actorId &&
    proof.permissionRevision === scope.permissionRevision &&
    proof.targetId === targetId &&
    proof.connectionId === connectionId &&
    proof.videoId === videoId.trim();
  async function act(save: boolean) {
    if (busy || searching || options.error || !target || !connection?.available || !videoId.trim())
      return;
    controller.current?.abort();
    const run = new AbortController();
    controller.current = run;
    setBusy(true);
    setMessage('');
    try {
      if (save && validProof) {
        const { title, creatorName, ...fields } = proof;
        void title;
        void creatorName;
        const command = ShopVideoSave.parse({ ...fields, idempotencyKey: key.current });
        await saveVideo(transport, command, target, run.signal);
        setProof(null);
        setMessage('ผูกวิดีโอกับคลิปแล้ว สถิติที่มีจะแสดงในหน้าคลิปของพาร์ทเนอร์');
      } else {
        setProof(null);
        const found = await lookupVideo(
          transport,
          { ...scope, targetId, connectionId, videoId: videoId.trim() },
          run.signal,
        );
        key.current = crypto.randomUUID();
        setProof(found);
      }
    } catch (error) {
      if (!run.signal.aborted)
        setMessage(
          error instanceof VideoRequestError
            ? error.message
            : 'ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง',
        );
    } finally {
      if (!run.signal.aborted) setBusy(false);
    }
  }
  return (
    <Card
      title="ผูกวิดีโอ TikTok Shop"
      description="เลือกคลิปและร้านค้า แล้วใส่ Video ID เพื่อตรวจชื่อวิดีโอและผู้สร้างก่อนยืนยัน"
    >
      <label className={forms.field}>
        ค้นหาคลิปหรือพาร์ทเนอร์
        <input
          maxLength={160}
          value={search}
          onChange={(e) => {
            edit();
            setTarget('');
            setSearch(e.target.value);
          }}
        />
      </label>
      {options.data?.hasMore && (
        <Text tone="muted">แสดง 100 รายการแรก พิมพ์ค้นหาเพื่อเจอคลิปที่ต้องการ</Text>
      )}
      {searching ? (
        <DataState state="loading" />
      ) : options.error ? (
        <DataState
          state={accessFailure || disabledIntegration ? 'unavailable' : 'error'}
          message={
            accessFailure
              ? options.error.message
              : disabledIntegration
                ? 'ยังไม่เปิดการเชื่อม TikTok Shop ติดต่อผู้ดูแลระบบ'
                : 'โหลดรายการคลิปและร้านค้าไม่สำเร็จ กรุณาลองอีกครั้ง'
          }
          onRetry={accessFailure || disabledIntegration ? undefined : () => void options.refetch()}
        />
      ) : !options.data?.connections.length ? (
        <Text>ยังไม่มีร้านค้า TikTok ที่เชื่อมต่อและอนุญาตให้บัญชีนี้ใช้</Text>
      ) : (
        <form
          className={forms.form}
          onSubmit={(e) => {
            e.preventDefault();
            void act(false);
          }}
        >
          {options.data.targets.length === 0 && (
            <Text role="status" tone="muted">
              {searchQuery
                ? 'ไม่พบคลิปที่ตรงกับคำค้น ลองชื่อคลิปหรือพาร์ทเนอร์อื่น'
                : 'ยังไม่มีคลิปให้เชื่อม ติดต่อทีม Labs D เพื่อเพิ่มคลิปและข้อตกลง'}
            </Text>
          )}
          <div className={forms.grid}>
            <label className={forms.field}>
              คลิปและข้อตกลง
              <select
                required
                value={targetId}
                disabled={busy}
                onChange={(e) => {
                  edit();
                  setTarget(e.target.value);
                }}
              >
                <option value="">เลือกคลิป</option>
                {options.data.targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={forms.field}>
              ร้านค้า TikTok
              <select
                required
                value={connectionId}
                disabled={busy}
                onChange={(e) => {
                  edit();
                  setConnection(e.target.value);
                }}
              >
                <option value="">เลือกร้านค้า</option>
                {options.data.connections.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.available}>
                    {c.label}
                    {c.available ? '' : ' · ยังไม่มีรายงานพร้อมใช้'}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={forms.field}>
            Video ID
            <input
              required
              maxLength={160}
              value={videoId}
              onChange={(e) => {
                edit();
                setVideo(e.target.value);
              }}
              autoComplete="off"
            />
          </label>
          <div className={forms.actions}>
            <Button
              type="submit"
              disabled={busy || !target || !connection?.available || !videoId.trim()}
            >
              ค้นหาวิดีโอ
            </Button>
          </div>
          {validProof && (
            <div className={forms.details}>
              <TextGroup>
                <Text as="h3">{proof.title}</Text>
                <Text>ผู้สร้าง: {proof.creatorName}</Text>
                <Text>ผูกกับ: {target?.label}</Text>
                <Text tone="muted">โปรดตรวจว่าเป็นวิดีโอของพาร์ทเนอร์และข้อตกลงนี้</Text>
              </TextGroup>
              <div className={forms.actions}>
                <Button
                  variant="primary"
                  disabled={busy || !target || !connection?.available}
                  onClick={() => void act(true)}
                >
                  ยืนยันผูกวิดีโอ
                </Button>
              </div>
            </div>
          )}
        </form>
      )}
      {busy && <Text role="status">กำลังดำเนินการ…</Text>}
      {message && <Text role="status">{message}</Text>}
    </Card>
  );
}
