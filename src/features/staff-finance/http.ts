import { FinanceSnapshot, FinancePublished, type FinancePublish } from '@/contracts/staff-finance';
import type { StaffAccessSessionValue } from '@/contracts/staff-access';
import type { z } from 'zod';
export class StaffFinanceError extends Error {
  constructor(readonly code: string) {
    super(
      code === 'PUBLICATION_DISABLED'
        ? 'ยังไม่เปิดเผยแพร่งวด คุณยังดูข้อมูลและหลักฐานได้'
        : code === 'FRESH_AUTH_REQUIRED'
        ? 'กรุณายืนยันตัวตนเจ้าหน้าที่อีกครั้ง'
        : code === 'CHANGED'
          ? 'ข้อมูลเปลี่ยนแล้ว กรุณาปิดหน้าตรวจรายการและโหลดข้อมูลใหม่'
          : code === 'ACCESS_DENIED'
            ? 'สิทธิ์เจ้าหน้าที่เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง'
            : 'ยังทำรายการไม่สำเร็จ กรุณาลองใหม่',
    );
  }
}
async function body(response: Response, signal: AbortSignal) {
  const data: unknown = await response.json().catch(() => null);
  signal.throwIfAborted();
  if (!response.ok)
    throw new StaffFinanceError(
      data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
        ? data.code
        : 'UNAVAILABLE',
    );
  return data;
}
export async function loadFinance(
  session: StaffAccessSessionValue,
  selection: {
    q?: string;
    partnerId?: string;
    scopeId?: string;
    cursor?: string;
    lineCursor?: string;
    generationId?: string;
  },
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ expectedRevision: session.revision });
  for (const [key, value] of Object.entries(selection))
    if (value !== undefined) params.set(key, value);
  const response = await fetch('/api/v1/staff/periods?' + params, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  const value = FinanceSnapshot.parse(await body(response, signal));
  if (
    value.session.userId !== session.userId ||
    value.session.revision !== session.revision ||
    value.partnerId !== (selection.partnerId ?? null) ||
    value.scopeId !== (selection.scopeId ?? null) ||
    value.q !== (selection.q ?? '') ||
    (selection.generationId !== undefined &&
      value.periods.items[0]?.generationId !== selection.generationId)
  )
    throw new StaffFinanceError('ACCESS_DENIED');
  return value;
}
export async function publishFinance(command: z.infer<typeof FinancePublish>, signal: AbortSignal) {
  const response = await fetch('/api/v1/staff/periods/publish', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  const result = FinancePublished.parse(await body(response, signal));
  if (result.version !== command.generationId) throw new StaffFinanceError('CHANGED');
  return result;
}
