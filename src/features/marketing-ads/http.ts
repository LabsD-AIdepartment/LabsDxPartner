import { AdRegistrationSnapshot, ResolvedAd } from '@/contracts/ad-registration';
import {
  NativeAdReceipt,
  NativeAdSaved,
  NativeTargetOptions,
  NativeTargetSaved,
  type NativeTargetCreate,
} from '@/contracts/marketing-native';
import type { z } from 'zod';
import type { RegistrationScopeValue } from '@/contracts/ad-registration';
import { RegistrationError, type AdRegistrationTransport } from './model';

async function request(path: string, signal: AbortSignal, command?: unknown) {
  const response = await fetch('/api/v1/staff/ads' + path, {
    method: command === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(command === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) }),
  });
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok) {
    const code = data && typeof data === 'object' && 'code' in data ? data.code : '';
    throw new RegistrationError(
      response.status === 409
        ? 'conflict'
        : response.status === 403 || response.status === 401
          ? 'forbidden'
          : 'temporary',
      code === 'FRESH_AUTH_REQUIRED'
        ? 'กรุณายืนยันตัวตนเจ้าหน้าที่อีกครั้ง'
        : response.status === 409
          ? 'คลิป สิทธิ์ หรือข้อมูลแอดเปลี่ยน กรุณาค้นหาแอดอีกครั้ง'
          : response.status === 403 || response.status === 401
            ? 'สิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง'
            : 'การเชื่อมต่อยังไม่พร้อม กรุณาลองอีกครั้ง',
    );
  }
  return data;
}
/** V2 native receipts are explicitly projected into the shared single-creative UI.
 * Never adapts performance/financial values; they retain their exact V2 contract. */
export function createNativeAdTransport(): AdRegistrationTransport {
  const commands = new Map<string, string>();
  const read: AdRegistrationTransport['read'] = ({ scope, signal }) =>
    request('?' + new URLSearchParams(scope), signal);
  return {
    read,
    async resolve({ scope, draft, signal }) {
      const value = NativeAdReceipt.parse(await request('/resolve', signal, { ...scope, draft }));
      if (value.source.creativeIds?.length !== 1)
        throw new RegistrationError('ambiguous', 'แอดนี้ยังไม่ระบุชิ้นงานเดียวที่ตรงกับคลิป');
      commands.clear();
      commands.set(value.receipt, crypto.randomUUID());
      return ResolvedAd.parse({
        receipt: value.receipt,
        expiresAt: value.expiresAt,
        draft: value.draft,
        accountId: value.source.identity.accountId,
        objectType: value.source.identity.objectType,
        name: value.source.name,
        creativeId: value.source.creativeIds[0],
        delivery: 'unknown',
        cover: null,
      });
    },
    async save({ scope, draft, receipt, signal }) {
      const idempotencyKey = commands.get(receipt);
      if (!idempotencyKey) throw new RegistrationError('expired', 'กรุณาค้นหาแอดอีกครั้ง');
      const saved = NativeAdSaved.parse(
        await request('/save', signal, { ...scope, draft, receipt, idempotencyKey }),
      );
      const snapshot = AdRegistrationSnapshot.parse(await read({ scope, signal }));
      if (
        snapshot.actorId !== scope.actorId ||
        snapshot.permissionRevision !== scope.permissionRevision
      )
        throw new RegistrationError('forbidden', 'สิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง');
      const association = snapshot.associations.find((row) => row.id === saved.associationId);
      if (
        !association ||
        association.target.partnerId !== saved.partnerId ||
        association.target.clipId !== saved.clipId ||
        association.target.agreementId !== saved.agreementId ||
        association.externalId !== saved.externalId
      )
        throw new RegistrationError(
          'conflict',
          'บันทึกแล้วแต่ยังตรวจสอบรายการไม่สำเร็จ กรุณาโหลดข้อมูลใหม่',
        );
      return { association, replayed: saved.replayed };
    },
  };
}
export async function loadTargetOptions(
  scope: RegistrationScopeValue,
  signal: AbortSignal,
  q = '',
) {
  const value = NativeTargetOptions.parse(
    await request('/targets?' + new URLSearchParams({ ...scope, q }), signal),
  );
  if (
    value.actorId !== scope.actorId ||
    value.permissionRevision !== scope.permissionRevision ||
    value.q !== q.trim()
  )
    throw new RegistrationError('forbidden', 'สิทธิ์เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง');
  return value;
}
export async function createTarget(
  command: z.infer<typeof NativeTargetCreate>,
  signal: AbortSignal,
) {
  return NativeTargetSaved.parse(await request('/targets', signal, command));
}
