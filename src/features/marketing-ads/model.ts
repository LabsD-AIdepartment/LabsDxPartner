import {
  AdDraft,
  AdRegistrationSnapshot,
  AdRegistrationResult,
  ResolvedAd,
  registrationIssue,
  type AdPlatformValue,
  type AdDraftValue,
  type AdRegistrationValue,
  type RegistrationScopeValue,
  type ResolvedAdValue,
} from '@/contracts/ad-registration';
export { platformLabels } from '@/contracts/platform-capabilities';
export const syncLabels = {
  queued: 'รอดึงข้อมูลครั้งแรก',
  syncing: 'กำลังดึงข้อมูล',
  ready: 'อัปเดตแล้ว',
  'needs-attention': 'ต้องแก้ไขการเชื่อมต่อ',
};
export type RegistrationErrorCode =
  | 'forbidden'
  | 'invalid'
  | 'not-found'
  | 'denied'
  | 'unsupported'
  | 'ambiguous'
  | 'temporary'
  | 'expired'
  | 'conflict';
export class RegistrationError extends Error {
  constructor(
    public code: RegistrationErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export type AdRegistrationTransport = {
  read: (request: { scope: RegistrationScopeValue; signal: AbortSignal }) => Promise<unknown>;
  resolve: (request: {
    scope: RegistrationScopeValue;
    draft: AdDraftValue;
    signal: AbortSignal;
  }) => Promise<unknown>;
  save: (request: {
    scope: RegistrationScopeValue;
    draft: AdDraftValue;
    receipt: string;
    signal: AbortSignal;
  }) => Promise<unknown>;
};
export function assertCurrentAccess(value: AdRegistrationValue, scope: RegistrationScopeValue) {
  if (value.actorId !== scope.actorId || value.permissionRevision !== scope.permissionRevision)
    throw new RegistrationError('forbidden', 'สิทธิ์เจ้าหน้าที่เปลี่ยน กรุณาเข้าสู่ระบบอีกครั้ง');
}
export function validateDraft(value: AdRegistrationValue, raw: AdDraftValue) {
  const parsed = AdDraft.safeParse(raw);
  if (!parsed.success)
    throw new RegistrationError('invalid', 'กรอก Ad ID และเลือกคลิปกับบัญชีให้ครบ');
  if (!value.canManage) throw new RegistrationError('forbidden', 'บัญชีนี้ไม่มีสิทธิ์เชื่อมแอด');
  const draft = parsed.data;
  const target = value.targets.find((target) => target.id === draft.targetId);
  const connection = value.connections.find((connection) => connection.id === draft.connectionId);
  if (!target || !target.available || !connection || connection.platform !== draft.platform)
    throw new RegistrationError('forbidden', 'คลิปหรือบัญชีโฆษณาไม่อยู่ในสิทธิ์ของคุณ');
  const issue = registrationIssue(connection, value.sourceMode);
  if (issue)
    throw new RegistrationError(connection.state === 'reconnect' ? 'denied' : 'unsupported', issue);
  return { draft, target, connection };
}
export const sameDraft = (a: AdDraftValue, b: AdDraftValue) =>
  a.targetId === b.targetId &&
  a.connectionId === b.connectionId &&
  a.platform === b.platform &&
  a.externalId === b.externalId;
const assertNotAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};
export async function readRegistration(
  transport: AdRegistrationTransport,
  scope: RegistrationScopeValue,
  signal: AbortSignal,
) {
  const value = AdRegistrationSnapshot.parse(await transport.read({ scope, signal }));
  assertNotAborted(signal);
  assertCurrentAccess(value, scope);
  for (const rows of [value.targets, value.connections, value.associations])
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new RegistrationError('invalid', 'ต้นทางส่งรายการซ้ำ');
  for (const row of value.associations) {
    const target = value.targets.find((target) => target.id === row.target.id);
    const connection = value.connections.find((connection) => connection.id === row.connection.id);
    if (
      !target ||
      target.partnerId !== row.target.partnerId ||
      target.clipId !== row.target.clipId ||
      target.agreementId !== row.target.agreementId ||
      !connection ||
      connection.accountId !== row.connection.accountId ||
      connection.platform !== row.connection.platform
    )
      throw new RegistrationError('forbidden', 'รายการแอดไม่ตรงกับคลิปหรือบัญชีที่อนุญาต');
  }
  return value;
}
export async function resolveRegistration(
  transport: AdRegistrationTransport,
  scope: RegistrationScopeValue,
  value: AdRegistrationValue,
  raw: AdDraftValue,
  signal: AbortSignal,
) {
  assertCurrentAccess(value, scope);
  const { draft, connection } = validateDraft(value, raw);
  const resolved = ResolvedAd.parse(await transport.resolve({ scope, draft, signal }));
  assertNotAborted(signal);
  if (!sameDraft(resolved.draft, draft) || resolved.accountId !== connection.accountId)
    throw new RegistrationError('invalid', 'แอดที่พบไม่ตรงกับคำค้นหรือบัญชีที่เลือก');
  return resolved;
}
export async function saveRegistration(
  transport: AdRegistrationTransport,
  scope: RegistrationScopeValue,
  value: AdRegistrationValue,
  resolved: ResolvedAdValue,
  raw: AdDraftValue,
  signal: AbortSignal,
) {
  assertCurrentAccess(value, scope);
  const { draft, target, connection } = validateDraft(value, raw);
  if (!sameDraft(draft, resolved.draft) || Date.parse(resolved.expiresAt) <= Date.now())
    throw new RegistrationError('expired', 'ข้อมูลแอดเปลี่ยนหรือหมดอายุ กรุณาค้นหาแอดอีกครั้ง');
  const result = AdRegistrationResult.parse(
    await transport.save({ scope, draft, receipt: resolved.receipt, signal }),
  );
  assertNotAborted(signal);
  const row = result.association;
  if (
    row.target.partnerId !== target.partnerId ||
    row.target.clipId !== target.clipId ||
    row.target.agreementId !== target.agreementId ||
    row.connection.accountId !== connection.accountId ||
    row.connection.platform !== draft.platform ||
    row.externalId !== draft.externalId ||
    row.creativeId !== resolved.creativeId
  )
    throw new RegistrationError('invalid', 'ผลการบันทึกไม่ตรงกับคลิปหรือแอดที่ตรวจสอบ');
  return result;
}
