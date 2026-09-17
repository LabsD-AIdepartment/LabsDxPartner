import { z } from 'zod';
import { Id } from '@/contracts/common';
import {
  BeneficiaryCatalog,
  type BeneficiaryCatalogValue,
  WithdrawalScope,
  type WithdrawalScopeValue,
} from '@/contracts/withdrawal-journey';
import { WITHDRAWAL_SCENARIO_MARKER, type DevKeyValueStorage } from './store';

// Development-only SEPARATE store for the editable synthetic payout beneficiary config. It lives under
// a DISTINCT key from the money/request store (which is NOT changed here): the money v2 blob stays
// fully compatible with old/new readers, a code rollback simply ignores this key (config inert,
// money intact), and a bad config never touches the request set. FAIL-CLOSED: a present-but-invalid/
// unreadable/foreign-scope config is `unavailable` (blocks new quotes/submits) and is NEVER a fixture
// fallback. No finance logic lives here — only masked config identity.

// Fixed synthetic catalog — masked LABELS only. No raw account number, credentials or provider.
export const BENEFICIARY_CATALOG: BeneficiaryCatalogValue = BeneficiaryCatalog.parse({
  banks: [
    { bankId: 'bank-scb', bankLabel: 'ธนาคารตัวอย่าง เอสซีบี' },
    { bankId: 'bank-kbank', bankLabel: 'ธนาคารตัวอย่าง กสิกร' },
    { bankId: 'bank-bbl', bankLabel: 'ธนาคารตัวอย่าง กรุงเทพ' },
  ],
  accounts: [
    { accountChoiceId: 'acct-1', maskedAccount: 'XXX-X-X1234-5' },
    { accountChoiceId: 'acct-2', maskedAccount: 'XXX-X-X6789-0' },
  ],
});

export function catalogBank(bankId: string): { bankId: string; bankLabel: string } | null {
  return BENEFICIARY_CATALOG.banks.find((b) => b.bankId === bankId) ?? null;
}
export function catalogAccount(
  accountChoiceId: string,
): { accountChoiceId: string; maskedAccount: string } | null {
  return BENEFICIARY_CATALOG.accounts.find((a) => a.accountChoiceId === accountChoiceId) ?? null;
}

// The config's OWN version bound — checked BEFORE any write.
export const CONFIG_VERSION_MAX = 10_000;

// Self-versioned config record: the `configVersion` (+ the quote-binding derivation) is committed in
// this SINGLE atomic key, so there is no cross-key cut. `state` never persists `unavailable` (a
// runtime read state). Only masked identity + catalog ids are stored — never a raw number.
export const PersistedBeneficiaryConfigV1 = z.strictObject({
  version: z.literal(1),
  scope: WithdrawalScope,
  configVersion: z.number().int().min(0).max(CONFIG_VERSION_MAX),
  state: z.enum(['missing', 'pending', 'verified']),
  displayName: z.string().min(1).max(140).nullable(),
  bankId: Id.nullable(),
  accountChoiceId: Id.nullable(),
  lastSaveKey: Id.nullable(),
});
export type PersistedBeneficiaryConfigValue = z.infer<typeof PersistedBeneficiaryConfigV1>;

export interface BeneficiaryNamespace {
  scenario: string;
  userId: string;
  partnerId: string;
  permissionRevision: string;
  payerId: string;
  currency: string;
}

export interface BeneficiaryLoadResult {
  // 'absent'      -> legacy: fixture fallback allowed.
  // 'loaded'      -> a valid, in-scope config.
  // 'unavailable' -> present but unreadable/corrupt/schema-invalid/foreign-scope: FAIL-CLOSED block,
  //                  NEVER reset to the fixture (a corrupt key is left in place — a fresh save or an
  //                  explicit reset recovers it).
  outcome: 'absent' | 'loaded' | 'unavailable';
  config: PersistedBeneficiaryConfigValue | null;
  warning: string | null;
}

function scopeEqual(a: WithdrawalScopeValue, b: WithdrawalScopeValue): boolean {
  return (
    a.userId === b.userId &&
    a.partnerId === b.partnerId &&
    a.permissionRevision === b.permissionRevision &&
    a.payerId === b.payerId &&
    a.currency === b.currency &&
    a.scenario === b.scenario
  );
}

// SEMANTIC coherence beyond the schema shape: the zod schema accepts a syntactically valid record
// whose identity is nonetheless meaningless (a `verified` config whose bankId is not a real catalog
// bank, or whose displayName is whitespace-only). Such a record must NOT read as verified/usable — it
// is fail-closed `unavailable` with its bytes preserved (never silently overwritten or fixture-
// substituted). Returns a warning to reject, or null when the persisted identity/state/catalog agree.
function configCoherenceError(c: PersistedBeneficiaryConfigValue): string | null {
  // Any PRESENT identity field must resolve: a non-blank name and real catalog choices.
  if (c.displayName !== null && c.displayName.trim().length === 0)
    return 'ชื่อผู้รับเงินในการตั้งค่าที่บันทึกไว้ว่างเปล่า จึงยังใช้ไม่ได้';
  if (c.bankId !== null && !catalogBank(c.bankId))
    return 'ธนาคารในการตั้งค่าที่บันทึกไว้ไม่อยู่ในแคตตาล็อก จึงยังใช้ไม่ได้';
  if (c.accountChoiceId !== null && !catalogAccount(c.accountChoiceId))
    return 'บัญชีในการตั้งค่าที่บันทึกไว้ไม่อยู่ในแคตตาล็อก จึงยังใช้ไม่ได้';
  // A `verified` config claims a usable recipient, so it MUST carry a complete, resolvable identity
  // (name + catalog bank + catalog account). An incomplete verified record is incoherent.
  if (
    c.state === 'verified' &&
    (c.displayName === null || c.bankId === null || c.accountChoiceId === null)
  )
    return 'การตั้งค่าบัญชีรับเงินที่ยืนยันแล้วมีข้อมูลไม่ครบ จึงยังใช้ไม่ได้';
  return null;
}

export class BeneficiaryConfigStore {
  private readonly key: string;
  constructor(
    private readonly storage: DevKeyValueStorage,
    namespace: BeneficiaryNamespace,
  ) {
    // Distinct key: the money store never uses the `beneficiary` segment.
    this.key = [
      WITHDRAWAL_SCENARIO_MARKER,
      'beneficiary',
      namespace.scenario,
      namespace.userId,
      namespace.partnerId,
      namespace.permissionRevision,
      namespace.payerId,
      namespace.currency,
    ]
      .map((segment) => encodeURIComponent(segment))
      .join('::');
  }

  load(scope: WithdrawalScopeValue): BeneficiaryLoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      // Read outage → fail closed (block). Bytes untouched; a later read can recover.
      return { outcome: 'unavailable', config: null, warning: 'อ่านการตั้งค่าบัญชีรับเงินไม่ได้ชั่วคราว จึงยังใช้ไม่ได้' };
    }
    if (raw === null) return { outcome: 'absent', config: null, warning: null };
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      // Present-but-corrupt → block; do NOT reset (a reset would fixture-fallback into a ready recipient).
      return { outcome: 'unavailable', config: null, warning: 'การตั้งค่าบัญชีรับเงินเสียหาย จึงยังใช้ไม่ได้' };
    }
    const parsed = PersistedBeneficiaryConfigV1.safeParse(parsedJson);
    if (!parsed.success)
      return { outcome: 'unavailable', config: null, warning: 'การตั้งค่าบัญชีรับเงินไม่ตรงรูปแบบปัจจุบัน จึงยังใช้ไม่ได้' };
    // Bad stored scope must NOT fall back to a verified fixture.
    if (!scopeEqual(parsed.data.scope, scope))
      return { outcome: 'unavailable', config: null, warning: 'การตั้งค่าบัญชีรับเงินไม่ตรงขอบเขต จึงยังใช้ไม่ได้' };
    // Shape-valid + in-scope, but the persisted identity/state/catalog must also COHERE — a crafted
    // verified record with an unknown catalog bank or a whitespace-only name is fail-closed here (bytes
    // preserved), so summary/readiness/config never disagree by reporting it verified/quotable.
    const incoherent = configCoherenceError(parsed.data);
    if (incoherent) return { outcome: 'unavailable', config: null, warning: incoherent };
    return { outcome: 'loaded', config: parsed.data, warning: null };
  }

  // A single atomic write. Returns a warning (and does NOT commit) on failure, so the caller never
  // reports a false `saved`.
  save(config: PersistedBeneficiaryConfigValue): string | null {
    try {
      this.storage.setItem(this.key, JSON.stringify(PersistedBeneficiaryConfigV1.parse(config)));
      return null;
    } catch {
      return 'บันทึกการตั้งค่าบัญชีรับเงินไม่สำเร็จ';
    }
  }

  // Clears ONLY this scope's config key (unrelated scopes retain theirs).
  reset(): string | null {
    try {
      this.storage.removeItem(this.key);
      return null;
    } catch {
      return 'ล้างการตั้งค่าบัญชีรับเงินไม่สำเร็จ';
    }
  }
}
