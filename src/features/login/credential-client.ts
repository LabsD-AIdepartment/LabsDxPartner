import { z } from 'zod';
import { safeReturnTo } from './access';
export const credentialMessages: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาลองอีกครั้ง',
  INVALID_INPUT: 'กรุณาตรวจสอบชื่อผู้ใช้และรหัสผ่านให้ถูกต้อง',
  INVALID_INVITE: 'ลิงก์คำเชิญนี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแล Labs D',
  INVALID_RESET: 'ลิงก์ตั้งรหัสใหม่นี้ใช้ไม่ได้แล้ว กรุณาติดต่อผู้ดูแล Labs D',
  USERNAME_UNAVAILABLE: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น',
  MEMBERSHIP_EXISTS: 'บัญชีนี้มีสิทธิ์กับพาร์ทเนอร์นี้แล้ว กรุณาเข้าสู่ระบบหรือติดต่อผู้ดูแล',
  FRESH_AUTH_REQUIRED: 'กรุณาเข้าสู่ระบบอีกครั้งก่อนทำรายการนี้',
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบอีกครั้ง',
  TOO_MANY_ATTEMPTS: 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
  INVALID_PASSWORD: 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
};
export class CredentialError extends Error {
  constructor(readonly code: string) {
    super(credentialMessages[code] ?? 'ยังทำรายการไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล Labs D');
  }
}
export async function credentialRequest<T>(
  path: string,
  input: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      body && typeof body === 'object' && 'code' in body && typeof body.code === 'string'
        ? body.code
        : '';
    throw new CredentialError(response.status === 429 ? 'TOO_MANY_ATTEMPTS' : code);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new CredentialError('INVALID_RESPONSE');
  return result.data;
}
export const signIn = (username: string, password: string, next = '/overview') =>
  credentialRequest(
    '/api/auth/sign-in/username',
    { username, password, callbackURL: safeReturnTo(next) },
    z.object({ user: z.object({ id: z.string().min(1) }) }),
  );
export const credentialErrorText = (error: unknown) =>
  error instanceof CredentialError ? error.message : 'การเชื่อมต่อขัดข้อง กรุณาลองใหม่';
