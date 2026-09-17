import { z } from 'zod';
import { Id, Instant } from './common';
import { Username } from './credentials';

// Account settings contract (Comment 28: manage account — login username/password, contact
// email/phone for transaction notifications, notification toggles, and request-only intents for
// leaving the partnership or deleting the account). This is a SCOPED synthetic-preview surface: it
// carries NO money totals, mutates NO native credential, and stores NO password digest/plaintext.
// The native username stays immutable (credential-auth.ts immutableUsername:true); a username change
// is only ever a REQUEST intent handled later by the identity service. Password changes are NOT part
// of this transport — they reuse the existing /access-preview credential lifecycle.

// Full-user/partner/permission fence. Every read/save/request is bound to exactly one declared
// scope; a differing field is a foreign scope and is refused (never blended into another actor).
export const SettingsScope = z.strictObject({
  userId: Id,
  partnerId: Id,
  permissionRevision: Id,
});
export type SettingsScopeValue = z.infer<typeof SettingsScope>;

// Notification toggles. Each flag governs whether the matching SYNTHETIC notice category is
// presented (see settings-model filter helper). No flag implies a real email/SMS is ever sent — the
// preview only affects presentation.
export const NotificationPreferences = z.strictObject({
  // ตัดรอบ/โอนถอนเงิน — withdrawal request accepted / transfer done
  withdrawals: z.boolean(),
  // ตัดรอบค่าคอมพร้อมถอน — a releasable period was cut and is ready to withdraw
  releases: z.boolean(),
  // ข้อตกลง/สัญญา — agreement or terms changes
  agreements: z.boolean(),
  // เหตุการณ์บัญชี — sign-in / security / account-level events
  accountEvents: z.boolean(),
});
export type NotificationPreferencesValue = z.infer<typeof NotificationPreferences>;

// Contact channels used for transaction notices. BOTH default to null: the real personal contacts
// are UNKNOWN in preview, so we never invent an email or phone number. A value is only ever present
// because the partner typed it into the form (or it was explicitly composed into `initial`).
export const ContactEmail = z.email().max(200);
// Formatted phone: allow +, spaces, parentheses and dashes so international and Thai numbers keep
// their grouping, but REQUIRE a real digit count. A punctuation-only value like '( ) -' — which the
// old {5,40} character-class regex accepted — is rejected. E.164 caps a subscriber number at 15
// digits; a Thai/landline minimum sits at 6, so we fence the *digit* count to 6–15 regardless of how
// the separators are laid out. Contact stays nullable elsewhere (unknown → null, never invented).
const PHONE_DIGITS = /\d/g;
export const ContactPhone = z
  .string()
  .trim()
  .regex(/^[+()\-\s0-9]{5,40}$/, 'กรอกเบอร์โทรด้วยตัวเลข อาจมี + ( ) - หรือเว้นวรรค ความยาว 5–40 อักขระ')
  .refine(
    (value) => {
      const digits = value.match(PHONE_DIGITS)?.length ?? 0;
      return digits >= 6 && digits <= 15;
    },
    'กรอกเบอร์โทรให้มีตัวเลขจริง 6–15 หลัก (เครื่องหมายวรรคตอนอย่างเดียวใช้ไม่ได้)',
  );
export const ContactChannels = z.strictObject({
  email: ContactEmail.nullable(),
  phone: ContactPhone.nullable(),
});
export type ContactChannelsValue = z.infer<typeof ContactChannels>;

// Request-only intents. NONE of these performs a destructive action: a username change waits for the
// identity service; leaving the partnership and deleting the account are recorded as pending requests
// a native operator reviews later. There is never a real logout, right-revocation or admin receipt.
export const AccountRequestKind = z.enum([
  'username-change',
  'partnership-withdrawal',
  'account-deletion',
]);
export type AccountRequestKindValue = z.infer<typeof AccountRequestKind>;

export const AccountRequestIntent = z.strictObject({
  id: Id,
  reference: Id,
  kind: AccountRequestKind,
  createdAt: Instant,
  status: z.literal('pending'),
  // Present ONLY for a username-change intent; the desired (not yet effective) login name.
  desiredUsername: Username.nullable().default(null),
});
export type AccountRequestIntentValue = z.infer<typeof AccountRequestIntent>;

// Explicit capability descriptor so the UI truthfully labels what it can and cannot do.
// - usernameChange: 'request-intent' — collect a desiredUsername and file a pending request; the
//   current login username stays current until the identity service acts. UI must label it
//   "ขอเปลี่ยนชื่อผู้ใช้" with a pending status; it must NOT present a new login username as active.
// - passwordChange: 'access-preview-lifecycle' — NOT handled here. Password changes go through the
//   already-working /access-preview credential lifecycle (createCelebrityJourney). This transport
//   never accepts a current password, never validates one, and never stores a digest/plaintext.
export const CredentialCapabilities = z.strictObject({
  usernameChange: z.literal('request-intent'),
  passwordChange: z.literal('access-preview-lifecycle'),
});
export type CredentialCapabilitiesValue = z.infer<typeof CredentialCapabilities>;

// Read snapshot. `revision` is the optimistic-concurrency token (opaque). No money totals appear.
export const AccountSettingsSnapshot = z.strictObject({
  revision: Id,
  // Full-actor fence carried IN the snapshot: userId is validated at the seam so a forged response for
  // another user under the SAME partner/permission can never pass (see validateSnapshotScope).
  userId: Id,
  partnerId: Id,
  permissionRevision: Id,
  displayName: z.string().min(1).max(160),
  // The CURRENT immutable native login username. Never edited by this metadata form.
  currentUsername: Username,
  contact: ContactChannels,
  preferences: NotificationPreferences,
  requests: z.array(AccountRequestIntent).max(50),
  capabilities: CredentialCapabilities,
});
export type AccountSettingsSnapshotValue = z.infer<typeof AccountSettingsSnapshot>;

// Save command for the ONLY optimistic mutation this transport performs: contact + preferences. The
// expectedRevision and idempotencyKey travel in the transport request envelope, not the command body.
export const SaveContactPreferences = z.strictObject({
  contact: ContactChannels,
  preferences: NotificationPreferences,
});
export type SaveContactPreferencesValue = z.infer<typeof SaveContactPreferences>;

// Request-intent command. `desiredUsername` is required for a username change and validated against
// the current username (must be a valid, DIFFERENT name). The other two carry no payload.
export const RequestIntentCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('username-change'), desiredUsername: Username }),
  z.strictObject({ kind: z.literal('partnership-withdrawal') }),
  z.strictObject({ kind: z.literal('account-deletion') }),
]);
export type RequestIntentCommandValue = z.infer<typeof RequestIntentCommand>;

// Every mutating response returns the full re-validated snapshot (so the loader re-checks the
// partner/permission fence and there are never money totals to reconcile), the echoed idempotency
// key, the created requestId (null for a contact save), and an honest durability caveat:
// persistenceWarning is non-null when the in-memory change could NOT be durably persisted — the UI
// must surface it and never claim the change will survive a reload.
export const AccountSettingsResult = z.strictObject({
  snapshot: AccountSettingsSnapshot,
  idempotencyKey: Id,
  requestId: Id.nullable().default(null),
  persistenceWarning: z.string().max(300).nullable().default(null),
});
export type AccountSettingsResultValue = z.infer<typeof AccountSettingsResult>;

// Typed, plain error codes (no PII, no stack detail crosses the seam).
export const AccountSettingsErrorCode = z.enum([
  'forbidden', // requested scope does not match the bound scope
  'scope-mismatch', // response scope does not match the requested scope
  'stale-revision', // expectedRevision no longer current — reload before retry
  'idempotency-conflict', // same idempotency key reused with a different payload
  'invalid-input', // command failed contract validation (e.g. username unchanged)
  'unavailable', // synthetic transport could not answer
]);
export type AccountSettingsErrorCodeValue = z.infer<typeof AccountSettingsErrorCode>;
