import {
  AccountSettingsResult,
  AccountSettingsSnapshot,
  RequestIntentCommand,
  SaveContactPreferences,
  type AccountSettingsErrorCodeValue,
  type AccountSettingsResultValue,
  type AccountSettingsSnapshotValue,
  type NotificationPreferencesValue,
  type RequestIntentCommandValue,
  type SaveContactPreferencesValue,
  type SettingsScopeValue,
} from '@/contracts/account-settings';

// Pure account-settings model: types, transport seam, loaders and validation. NO JSX and NO
// synthetic authority live here — the transport (dev/account-settings-transport.ts) owns state; this
// module only validates what crosses the seam so the UI never trusts an unparsed payload.

export type AccountSettingsScope = SettingsScopeValue;

// A typed, plain-code error. Message is a short Thai string safe to show; `code` drives handling.
export class AccountSettingsError extends Error {
  constructor(
    readonly code: AccountSettingsErrorCodeValue,
    message?: string,
  ) {
    super(message ?? defaultMessage[code]);
    this.name = 'AccountSettingsError';
  }
}
const defaultMessage: Record<AccountSettingsErrorCodeValue, string> = {
  forbidden: 'ไม่มีสิทธิ์เข้าถึงการตั้งค่าบัญชีนี้',
  'scope-mismatch': 'ข้อมูลบัญชีไม่ตรงกับพาร์ทเนอร์ที่เลือก',
  'stale-revision': 'ข้อมูลบัญชีเปลี่ยนแล้ว กรุณารีเฟรชก่อนบันทึก',
  'idempotency-conflict': 'รหัสรายการถูกใช้กับคำสั่งอื่นแล้ว',
  'invalid-input': 'ข้อมูลที่กรอกไม่ถูกต้อง',
  unavailable: 'บริการตั้งค่าบัญชีตัวอย่างไม่พร้อมใช้งานชั่วคราว',
};

// The seam the UI is written against. Every method returns `unknown`; the loaders below validate.
export interface SaveContactPreferencesRequest {
  scope: SettingsScopeValue;
  expectedRevision: string;
  idempotencyKey: string;
  command: SaveContactPreferencesValue;
  signal: AbortSignal;
}
export interface AccountRequestRequest {
  scope: SettingsScopeValue;
  expectedRevision: string;
  idempotencyKey: string;
  command: RequestIntentCommandValue;
  signal: AbortSignal;
}
export interface AccountSettingsTransport {
  load(scope: SettingsScopeValue, signal: AbortSignal): Promise<unknown>;
  saveContactPreferences(request: SaveContactPreferencesRequest): Promise<unknown>;
  requestIntent(request: AccountRequestRequest): Promise<unknown>;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

// Re-check the FULL user/partner/permission fence on any snapshot that crosses the seam. userId is
// carried in the snapshot and validated here so a forged response for another user under the SAME
// partner + permission revision cannot pass — it mirrors the account metadata contract's userId fence.
export function validateSnapshotScope(
  snapshot: AccountSettingsSnapshotValue,
  scope: SettingsScopeValue,
): void {
  if (
    snapshot.userId !== scope.userId ||
    snapshot.partnerId !== scope.partnerId ||
    snapshot.permissionRevision !== scope.permissionRevision
  )
    throw new AccountSettingsError('scope-mismatch');
}

export async function loadAccountSettings(
  transport: AccountSettingsTransport,
  scope: SettingsScopeValue,
  signal: AbortSignal,
): Promise<AccountSettingsSnapshotValue> {
  const raw = await transport.load(scope, signal);
  throwIfAborted(signal);
  const snapshot = AccountSettingsSnapshot.parse(raw);
  validateSnapshotScope(snapshot, scope);
  return snapshot;
}

function validateResult(
  raw: unknown,
  request: { scope: SettingsScopeValue; idempotencyKey: string; signal: AbortSignal },
): AccountSettingsResultValue {
  throwIfAborted(request.signal);
  const result = AccountSettingsResult.parse(raw);
  validateSnapshotScope(result.snapshot, request.scope);
  if (result.idempotencyKey !== request.idempotencyKey)
    throw new AccountSettingsError('scope-mismatch');
  return result;
}

export async function saveContactPreferences(
  transport: AccountSettingsTransport,
  request: SaveContactPreferencesRequest,
): Promise<AccountSettingsResultValue> {
  SaveContactPreferences.parse(request.command);
  const raw = await transport.saveContactPreferences(request);
  return validateResult(raw, request);
}

export async function submitAccountRequest(
  transport: AccountSettingsTransport,
  request: AccountRequestRequest,
): Promise<AccountSettingsResultValue> {
  RequestIntentCommand.parse(request.command);
  const raw = await transport.requestIntent(request);
  return validateResult(raw, request);
}

// ---- Notification presentation helper -------------------------------------------------------
// The preferences ACTUALLY affect presentation: this maps a synthetic notice category to its
// governing toggle. It sends nothing and claims no email/SMS — it only decides what shows.
export type NoticeCategory = keyof NotificationPreferencesValue;
export function noticeAllowed(
  category: NoticeCategory,
  preferences: NotificationPreferencesValue,
): boolean {
  return preferences[category];
}
export function filterNotices<T extends { category: NoticeCategory }>(
  notices: readonly T[],
  preferences: NotificationPreferencesValue,
): T[] {
  return notices.filter((notice) => noticeAllowed(notice.category, preferences));
}
