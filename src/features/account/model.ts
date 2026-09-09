import { z } from 'zod';
import { AccountResponse, AccountAction, AccountActionResult } from '@/contracts/account';
import type { QueryScope } from '@/shared/query/keys';
export type AccountValue = z.infer<typeof AccountResponse>;
export type Action = z.infer<typeof AccountAction>;
export type AccountTransport = {
  read: (scope: QueryScope, signal: AbortSignal) => Promise<unknown>;
  act: (request: {
    scope: QueryScope;
    expectedRevision: string;
    idempotencyKey: string;
    command: Action;
    signal: AbortSignal;
  }) => Promise<unknown>;
};
export async function loadAccount(
  transport: AccountTransport,
  scope: QueryScope,
  signal: AbortSignal,
) {
  const raw = await transport.read(scope, signal);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const value = AccountResponse.parse(raw);
  if (
    value.data.userId !== scope.userId ||
    (value.data.agreement && value.data.agreement.partnerId !== scope.partnerId)
  )
    throw new Error('ข้อมูลบัญชีไม่ตรงกับพาร์ทเนอร์ที่เลือก');
  if (new Set(value.data.providers.map((p) => p.provider)).size !== value.data.providers.length)
    throw new Error('ข้อมูลวิธีเข้าสู่ระบบซ้ำกัน');
  return value;
}
export async function actOnAccount(
  transport: AccountTransport,
  request: Parameters<AccountTransport['act']>[0],
) {
  AccountAction.parse(request.command);
  const raw = await transport.act(request);
  if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const value = AccountActionResult.parse(raw);
  if (value.userId !== request.scope.userId) throw new Error('ผลรายการไม่ตรงกับบัญชีนี้');
  return value;
}
