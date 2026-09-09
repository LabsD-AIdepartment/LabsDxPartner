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
  'no-agreement',
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
export function accountFixture(mode: AccountMode = 'ready', username = 'partner.demo') {
  const sample = readyScenario().account;
  return AccountResponse.parse({
    revision: '1',
    partnerId: accountScope.partnerId,
    permissionRevision: accountScope.permissionRevision,
    dataState: mode === 'stale' || mode === 'unavailable' ? mode : 'ready',
    generatedAt: at,
    dataThrough: at,
    reasons: mode === 'stale' ? ['ข้อมูลบัญชีกำลังอัปเดต'] : [],
    requestId: 'synthetic-account-request',
    data: {
      ...sample,
      userId: accountScope.userId,
      username,
      displayName: username,
      agreement:
        mode === 'no-agreement'
          ? null
          : { ...sample.agreement!, partnerId: accountScope.partnerId },
      termsSummary:
        'ตัวอย่างข้อตกลง: Organic 10% และ Brand ads 3% ของยอดที่เข้าเงื่อนไข ตรวจสอบตามเวอร์ชันข้อตกลง',
    },
  });
}
export function createAccountTransport(
  mode: AccountMode,
  username = 'partner.demo',
): AccountTransport {
  const value = accountFixture(mode, username),
    done = new Map<string, { fingerprint: string; result: unknown }>();
  const assertScope = (scope: typeof accountScope) => {
    if (
      scope.userId !== accountScope.userId ||
      scope.partnerId !== accountScope.partnerId ||
      scope.permissionRevision !== accountScope.permissionRevision ||
      mode === 'forbidden'
    )
      throw new Error('ไม่มีสิทธิ์เข้าบัญชีนี้');
  };
  return {
    read: async (scope, signal) => {
      await previewWait(signal, mode === 'loading' ? null : 30);
      assertScope(scope);
      if (mode === 'error') throw new Error('การเชื่อมต่อขัดข้อง');
      return structuredClone(value);
    },
    act: async (r) => {
      await previewWait(r.signal, mode === 'pending' ? null : 150);
      assertScope(r.scope);
      const fingerprint = JSON.stringify(r.command),
        previous = done.get(r.idempotencyKey);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error('รหัสรายการถูกใช้กับคำสั่งอื่นแล้ว');
        return structuredClone(previous.result);
      }
      if (mode === 'error') throw new Error('เชื่อมต่อไม่สำเร็จ ลองใหม่');
      if (r.expectedRevision !== value.revision)
        throw new Error('ข้อมูลบัญชีเปลี่ยนแล้ว กรุณารีเฟรช');
      const result = (status: string, message: string) => ({
        userId: r.scope.userId,
        requestId: 'synthetic-account-action',
        status,
        message,
      });
      if (mode === 'reauth')
        return result('requires-reauth', 'กรุณายืนยันตัวตนอีกครั้งก่อนจัดการบัญชี');
      if (r.command.action === 'recover')
        return result(
          'recovery-required',
          'ติดต่อผู้ดูแลที่ประสานงานกับคุณ เมื่อยืนยันเจ้าของบัญชีแล้ว ทีมจะส่งลิงก์ให้ตั้งรหัสผ่านใหม่ด้วยตัวเอง ยังไม่มีการส่งลิงก์หรือเปลี่ยนรหัสผ่าน',
        );
      const response = result('complete', 'ออกจากระบบจำลองแล้ว');
      done.set(r.idempotencyKey, { fingerprint, result: response });
      return response;
    },
  };
}
