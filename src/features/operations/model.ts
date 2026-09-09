import { z } from 'zod';
import {
  OpsSnapshot,
  OpsCommand,
  OpsActionResult,
  type OpsCapability,
} from '@/contracts/operations';
import type { MoneyValue } from '@/contracts/common';
export type OpsValue = z.infer<typeof OpsSnapshot>;
export type Command = z.infer<typeof OpsCommand>;
export type DraftCommand = Command extends infer C
  ? C extends Command
    ? Omit<C, 'idempotencyKey'>
    : never
  : never;
export type OpsView = 'partners' | 'imports' | 'periods';
export type OpsScope = { actorId: string; permissionRevision: string };
export type OpsTransport = {
  read: (request: {
    scope: OpsScope;
    view: OpsView;
    cursor: string | null;
    signal: AbortSignal;
  }) => Promise<unknown>;
  act: (request: {
    scope: OpsScope;
    expectedRevision: string;
    command: Command;
    signal: AbortSignal;
  }) => Promise<unknown>;
};
export class OpsError extends Error {
  constructor(
    public code: 'forbidden' | 'reauth' | 'changed' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}
export const capabilityFor: Record<Command['action'], z.infer<typeof OpsCapability>> = {
  invite: 'manage_partners',
  membership: 'manage_partners',
  terms: 'manage_partners',
  import: 'review_imports',
  publish: 'publish_statements',
  payment: 'record_payments',
};
export const commandTarget = (c: Command) =>
  c.action === 'publish'
    ? c.periodId
    : c.action === 'payment'
      ? c.statementId
      : c.action === 'import'
        ? c.source
        : c.partnerId;
export function moneyInput(text: string): MoneyValue {
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(text.trim()))
    throw new Error('กรอกจำนวนเงินไม่ติดลบและทศนิยมไม่เกิน 2 ตำแหน่ง');
  const [whole, decimal = ''] = text.trim().split('.');
  return {
    currency: 'THB',
    minor: (BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'))).toString(),
  };
}
export async function loadOps(
  transport: OpsTransport,
  request: Parameters<OpsTransport['read']>[0],
) {
  const raw = await transport.read(request);
  if (request.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const value = OpsSnapshot.parse(raw);
  if (
    value.actorId !== request.scope.actorId ||
    value.permissionRevision !== request.scope.permissionRevision
  )
    throw new OpsError('forbidden', 'สิทธิ์เจ้าหน้าที่เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง');
  const statementIds = new Set<string>();
  for (const period of value.periods.items) {
    const statement = period.statement;
    if ((period.status === 'published') !== !!statement)
      throw new OpsError('invalid', 'สถานะงวดไม่ตรงกับใบสรุป');
    if (statement) {
      if (
        statementIds.has(statement.id) ||
        statement.newEarnings.minor !== period.confirmed.minor ||
        Date.parse(statement.period.from) !== Date.parse(period.period.from) ||
        Date.parse(statement.period.toExclusive) !== Date.parse(period.period.toExclusive)
      )
        throw new OpsError('invalid', 'ใบสรุปไม่ตรงกับงวดที่ตรวจสอบ');
      statementIds.add(statement.id);
    }
  }
  for (const rows of [
    value.partners.items,
    value.imports.items,
    value.periods.items,
    value.agreements,
  ])
    if (new Set(rows.map((x) => x.id)).size !== rows.length)
      throw new OpsError('invalid', 'รายการอ้างอิงซ้ำกัน');
  if (request.cursor && value[request.view].nextCursor === request.cursor)
    throw new OpsError('invalid', 'ข้อมูลหน้าถัดไปไม่ถูกต้อง');
  return value;
}
export function validateCommand(c: Command, value: OpsValue) {
  if (!value.capabilities.includes(capabilityFor[c.action]))
    throw new OpsError('forbidden', 'ไม่มีสิทธิ์ทำรายการนี้');
  if (value.dataState !== 'ready')
    throw new OpsError('changed', 'ข้อมูลยังไม่พร้อม กรุณารีเฟรชก่อนทำรายการ');
  if ('partnerId' in c && !value.partners.items.some((p) => p.id === c.partnerId))
    throw new OpsError('invalid', 'ไม่พบพาร์ทเนอร์ในข้อมูลที่ตรวจสอบ');
  if (
    c.action === 'terms' &&
    !value.agreements.some((a) => a.id === c.agreementVersion && a.partnerId === c.partnerId)
  )
    throw new OpsError('invalid', 'ข้อตกลงไม่ตรงกับพาร์ทเนอร์');
  if (
    c.action === 'terms' &&
    [c.contentRefs, c.skuRefs].some((rows) => new Set(rows).size !== rows.length)
  )
    throw new OpsError('invalid', 'รหัสผูกข้อมูลซ้ำกัน');
  if (c.action === 'invite' && Date.parse(c.expiresAt) <= Date.now())
    throw new OpsError('invalid', 'คำเชิญต้องมีวันหมดอายุในอนาคต');
  if (c.action === 'publish') {
    const p = value.periods.items.find((p) => p.id === c.periodId && p.partnerId === c.partnerId);
    if (
      !p ||
      p.status !== 'reconciled' ||
      p.unresolvedCount > 0 ||
      p.generation !== c.generation ||
      p.evidenceRef !== c.evidenceRef
    )
      throw new OpsError('changed', 'งวดนี้ยังไม่ผ่านการตรวจสอบครบถ้วน');
  }
  if (c.action === 'payment') {
    if (Date.parse(c.paidAt) > Date.now())
      throw new OpsError('invalid', 'วันที่จ่ายจริงต้องไม่อยู่ในอนาคต');
    const p = value.periods.items.find(
      (p) => p.partnerId === c.partnerId && p.statement?.id === c.statementId,
    );
    const amounts = [c.cash, c.withholding, c.other].map((m) => BigInt(m.minor)),
      total = amounts.reduce((s, n) => s + n, 0n);
    if (
      !p?.statement ||
      p.status !== 'published' ||
      amounts.some((n) => n < 0n) ||
      total <= 0n ||
      total > BigInt(p.statement.closing.minor)
    )
      throw new OpsError('invalid', 'ยอดชำระต้องมากกว่าศูนย์และไม่เกินยอดคงเหลือ');
  }
}
export async function submitOps(
  transport: OpsTransport,
  scope: OpsScope,
  value: OpsValue,
  draft: DraftCommand,
  idempotencyKey: string,
  signal: AbortSignal,
) {
  const command = OpsCommand.parse({ ...draft, idempotencyKey });
  validateCommand(command, value);
  const raw = await transport.act({ scope, expectedRevision: value.revision, command, signal });
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const result = OpsActionResult.parse(raw);
  if (result.actorId !== scope.actorId || result.targetId !== commandTarget(command))
    throw new OpsError('invalid', 'ผลรายการไม่ตรงกับรายการที่ยืนยัน');
  if (result.status === 'rejected') throw new OpsError('changed', result.message);
  return result;
}
