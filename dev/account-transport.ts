import { AccountResponse } from '@/contracts/account';
import type { AccountTransport } from '@/features/account/model';
import { readyScenario, at } from './scenarios/ready';
import { previewWait } from './async-preview';
export const accountScope = {
  userId: 'preview-user',
  partnerId: 'preview-partner',
  permissionRevision: '1',
};
export const accountModes = [
  'ready',
  'single-method',
  'no-agreement',
  'conflict',
  'reauth',
  'recovery',
  'pending',
  'stale',
  'unavailable',
  'loading',
  'error',
  'forbidden',
] as const;
export type AccountMode = (typeof accountModes)[number];
export function accountFixture(mode: AccountMode = 'ready') {
  const sample = readyScenario().account;
  return AccountResponse.parse({
    revision: '1',
    dataState: mode === 'stale' || mode === 'unavailable' ? mode : 'ready',
    generatedAt: at,
    dataThrough: at,
    reasons: mode === 'stale' ? ['ข้อมูลบัญชีกำลังอัปเดต'] : [],
    requestId: 'synthetic-account-request',
    data: {
      ...sample,
      userId: accountScope.userId,
      agreement:
        mode === 'no-agreement'
          ? null
          : { ...sample.agreement!, partnerId: accountScope.partnerId },
      termsSummary:
        'ตัวอย่างข้อตกลง: Organic 10% และ Brand ads 3% ของยอดที่เข้าเงื่อนไข ตรวจสอบตามเวอร์ชันข้อตกลง',
      providers:
        mode === 'single-method'
          ? [{ provider: 'google', canUnlink: false }]
          : [
              { provider: 'google', canUnlink: true },
              { provider: 'line', canUnlink: true },
            ],
    },
  });
}
export function createAccountTransport(mode: AccountMode): AccountTransport {
  const value = accountFixture(mode),
    done = new Map<string, { fingerprint: string; result: unknown }>();
  return {
    read: async (scope, signal) => {
      await previewWait(signal, mode === 'loading' ? null : 30);
      if (
        mode === 'forbidden' ||
        scope.userId !== accountScope.userId ||
        scope.partnerId !== accountScope.partnerId ||
        scope.permissionRevision !== accountScope.permissionRevision
      )
        throw new Error('ไม่มีสิทธิ์เข้าบัญชีนี้');
      if (mode === 'error') throw new Error('การเชื่อมต่อขัดข้อง');
      return structuredClone(value);
    },
    act: async (r) => {
      await previewWait(r.signal, mode === 'pending' ? null : 150);
      if (
        r.scope.userId !== accountScope.userId ||
        r.scope.partnerId !== accountScope.partnerId ||
        r.scope.permissionRevision !== accountScope.permissionRevision
      )
        throw new Error('ไม่มีสิทธิ์เข้าบัญชีนี้');
      const fingerprint = JSON.stringify(r.command);
      const previous = done.get(r.idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error('รหัสรายการถูกใช้กับคำสั่งอื่นแล้ว');
        return structuredClone(previous.result);
      }
      if (mode === 'error') throw new Error('เชื่อมต่อไม่สำเร็จ ลองใหม่');
      if (mode === 'forbidden') throw new Error('สิทธิ์ถูกยกเลิก');
      if (r.expectedRevision !== value.revision)
        throw new Error('ข้อมูลบัญชีเปลี่ยนแล้ว กรุณารีเฟรช');
      const c = r.command;
      if (value.dataState !== 'ready' && c.action !== 'logout' && c.action !== 'recover')
        throw new Error('ข้อมูลยังไม่พร้อม กรุณารีเฟรช');
      const result = (status: string, message: string) => ({
        userId: r.scope.userId,
        requestId: 'synthetic-account-action',
        status,
        message,
      });
      if (mode === 'reauth')
        return result('requires-reauth', 'กรุณายืนยันตัวตนอีกครั้งก่อนจัดการบัญชี');
      if (mode === 'conflict' && c.action === 'link')
        return result(
          'conflict',
          'วิธีเข้าสู่ระบบนี้ถูกใช้กับบัญชีอื่นแล้ว ติดต่อผู้ดูแลเพื่อพิสูจน์ความเป็นเจ้าของ ห้ามรวมจากอีเมลอย่างเดียว',
        );
      if (mode === 'recovery' || c.action === 'recover')
        return result(
          'recovery-required',
          'ใช้วิธีอื่นที่เชื่อมไว้ หรือติดต่อผู้ดูแลเพื่อตรวจตัวตน ยังไม่มีการเปลี่ยนบัญชี',
        );
      if (c.action === 'unlink') {
        if (value.data.providers.length <= 1)
          return result('last-method', 'ไม่สามารถลบวิธีเข้าสู่ระบบสุดท้ายได้');
        value.data.providers = value.data.providers.filter((p) => p.provider !== c.provider);
      }
      if (c.action === 'link' && !value.data.providers.some((p) => p.provider === c.provider))
        value.data.providers.push({ provider: c.provider, canUnlink: true });
      value.data.providers = value.data.providers.map((p) => ({
        ...p,
        canUnlink: value.data.providers.length > 1,
      }));
      value.revision = (BigInt(value.revision) + 1n).toString();
      const response = result(
        'complete',
        c.action === 'logout'
          ? 'ออกจากระบบจำลองแล้ว'
          : 'อัปเดตบัญชีจำลองแล้ว ไม่มีการเชื่อมบัญชีภายนอกจริง',
      );
      done.set(r.idempotencyKey, { fingerprint, result: response });
      return response;
    },
  };
}
