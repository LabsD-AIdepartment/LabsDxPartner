import type { PeriodReferenceValue, QuoteDeductionKindValue } from '@/contracts/withdrawal-journey';

// Development-only synthetic withdrawal scenarios. No live endpoint/DB/gateway. Every amount
// is authored data in satang (integer THB minor). Nothing here invents a tax rate or fee: a
// deduction is either an explicit "none" decision or a scenario-authored line bound to an
// exact gross amount + policy revision. An unsupported amount stays UNAVAILABLE.

export type BeneficiaryConfig =
  | { state: 'known'; displayName: string; bankName: string; maskedAccount: string }
  | { state: 'missing'; reasons: string[] }
  | { state: 'pending'; reasons: string[] };

export type FactConfig = 'approved' | 'unknown';
export type TaxFactConfig =
  | { status: 'approved'; declaredWithholding: 'applies' | 'none' }
  | { status: 'unknown' };

// Honest POOL provenance for a period whose release makes up part of the accumulated balance.
// `amount` is the pool-release amount (NOT a per-withdrawal allocation). `statementId` links a
// retained period statement ONLY when a real mapping is supplied; otherwise there is no link.
export type SourcePeriodConfig = {
  periodId: string;
  label: string;
  releasedAt: string;
  amount: string;
  statementId?: string;
};

export type DeductionLine = { kind: QuoteDeductionKindValue; label: string; amount: string };
export type DeductionPolicy =
  // Explicit synthetic "no withholding / no fee" decision. Quotes exact cash == gross for any
  // positive amount. This is a real zero-policy decision, NOT a fallback for unknown rules.
  | { kind: 'none' }
  // Scenario-authored deduction table keyed by EXACT gross (satang). A gross not in the table
  // returns `amount_unsupported`; a rate is never invented and a different gross is never
  // reused.
  | { kind: 'applies'; table: Record<string, DeductionLine[]> };

export interface WithdrawalScenario {
  name: string;
  title: string;
  balanceState: 'known' | 'unavailable';
  balanceReasons: string[];
  // `base.sourcePeriods` is the honest provenance of the opening released amount: its `amount`
  // values MUST sum to `base.released` (checked in tests). It is pool provenance with
  // allocationModeled:false — never a claim of which period funds a specific withdrawal.
  base: { released: string; settled: string; held: string; sourcePeriods: SourcePeriodConfig[] };
  currentPeriodPending: string | null;
  currentPeriod: PeriodReferenceValue | null;
  beneficiary: BeneficiaryConfig;
  facts: {
    payer: FactConfig;
    releaseRule: FactConfig;
    taxPolicy: TaxFactConfig;
    beneficiary: FactConfig;
  };
  versions: { payer: string; releaseRule: string; taxPolicy: string; beneficiary: string };
  deduction: DeductionPolicy;
  // Prior/other periods that can be released once each (release adds `amount` to released). The
  // actual release TIME is recorded at runtime (not this fixture), so a frozen request context
  // reflects when a simulated release really happened. `statementId` links a retained statement
  // only when a real mapping is supplied.
  releasable: { periodId: string; amount: string; label: string; statementId?: string }[];
  persistenceNote: string | null;
  // OPTIONAL authored provenance of the SINGLE most-recent settlement that predates any
  // controller-submitted request — the opening "last successful withdrawal" the summary surfaces.
  // Present ONLY when a scenario has explicit, base.settled-coherent evidence of a real historical
  // part-payment; omitted otherwise so an unknown settlement history is NEVER fabricated into a
  // "none". `net` is the ACTUAL cash paid (a magnitude that must not exceed base.settled, since a
  // single payment cannot exceed the total ever settled — checked in tests); `paidAt` is the real
  // settlement instant from the fixture story. This is presentation provenance only: it is NEVER
  // added to base.settled/componentsMinor (that aggregate already includes it), so it cannot
  // double-count. A later controller-recorded paid request supersedes it by paid time.
  openingLastWithdrawal?: { requestRef: string; net: string; paidAt: string };
}

// The opening 20,000 THB is honestly two prior closed periods of 10,000 each (June + July 2569) —
// not an anonymous lump and not an assumed FIFO/tax order. Reused by the ready scenarios.
const openingTwentyK: SourcePeriodConfig[] = [
  {
    periodId: 'period-2026-06',
    label: 'งวด มิถุนายน 2569',
    releasedAt: '2026-07-01T00:00:00+07:00',
    amount: '1000000',
  },
  {
    periodId: 'period-2026-07',
    label: 'งวด กรกฎาคม 2569',
    releasedAt: '2026-08-01T00:00:00+07:00',
    amount: '1000000',
  },
];
const augustReleasable = {
  periodId: 'period-2026-08',
  amount: '1000000',
  label: 'งวด สิงหาคม 2569',
};

const currentPeriod: PeriodReferenceValue = {
  periodId: 'period-2026-09',
  label: 'งวดปัจจุบัน กันยายน 2569',
  from: '2026-09-01T00:00:00+07:00',
  toExclusive: '2026-10-01T00:00:00+07:00',
};

const knownBeneficiary: BeneficiaryConfig = {
  state: 'known',
  displayName: 'บริษัท ตัวอย่าง จำกัด',
  bankName: 'ธนาคารตัวอย่าง',
  maskedAccount: 'XXX-X-X1234-5',
};

const approvedFacts = {
  payer: 'approved',
  releaseRule: 'approved',
  taxPolicy: { status: 'approved', declaredWithholding: 'none' },
  beneficiary: 'approved',
} as const;

const versions = {
  payer: 'payer-v1',
  releaseRule: 'release-v1',
  taxPolicy: 'tax-v1',
  beneficiary: 'ben-v1',
} as const;

// Golden case: 20,000 THB released from prior period(s); 7,000 THB pending in the current
// period (separate, never withdrawable until released). Explicit no-WHT/no-fee decision, so a
// 5,000 request nets 5,000 cash, leaving 15,000 available and 5,000 reserved.
const golden: WithdrawalScenario = {
  name: 'golden',
  title: 'พร้อมถอน (ไม่มีหัก ณ ที่จ่าย/ค่าธรรมเนียม)',
  balanceState: 'known',
  balanceReasons: [],
  base: { released: '2000000', settled: '0', held: '0', sourcePeriods: openingTwentyK },
  currentPeriodPending: '700000',
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: approvedFacts,
  versions,
  deduction: { kind: 'none' },
  // Closing another prior period releases 10,000 THB exactly once.
  releasable: [augustReleasable],
  persistenceNote: null,
};

// Withholding applies: scenario-authored deduction table bound to exact gross + policy
// revision. Only the listed grosses are supported; anything else is `amount_unsupported`.
const appliesWht: WithdrawalScenario = {
  name: 'applies-wht',
  title: 'มีหัก ณ ที่จ่าย (ตารางกำหนดตามจำนวนที่ระบุ)',
  balanceState: 'known',
  balanceReasons: [],
  base: { released: '2000000', settled: '0', held: '0', sourcePeriods: openingTwentyK },
  currentPeriodPending: '700000',
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: { ...approvedFacts, taxPolicy: { status: 'approved', declaredWithholding: 'applies' } },
  versions,
  deduction: {
    kind: 'applies',
    table: {
      // 5,000 gross → 3% WHT (150) → 4,850 net.
      '500000': [{ kind: 'withholding_tax', label: 'หัก ณ ที่จ่าย 3%', amount: '15000' }],
      // 10,000 gross → 3% WHT (300) → 9,700 net.
      '1000000': [{ kind: 'withholding_tax', label: 'หัก ณ ที่จ่าย 3%', amount: '30000' }],
    },
  },
  releasable: [augustReleasable],
  persistenceNote: null,
};

// Beneficiary not configured: summary shows missing; quote is unavailable; no confirmation.
const missingBeneficiary: WithdrawalScenario = {
  name: 'missing-beneficiary',
  title: 'ยังไม่ได้ตั้งค่าบัญชีผู้รับเงิน',
  balanceState: 'known',
  balanceReasons: [],
  base: { released: '2000000', settled: '0', held: '0', sourcePeriods: openingTwentyK },
  currentPeriodPending: '700000',
  currentPeriod,
  beneficiary: { state: 'missing', reasons: ['ยังไม่ได้เพิ่มบัญชีผู้รับเงินสำหรับขอบเขตนี้'] },
  facts: { ...approvedFacts, beneficiary: 'unknown' },
  versions,
  deduction: { kind: 'none' },
  releasable: [],
  persistenceNote: null,
};

// Beneficiary configured but pending verification: presented as pending; not confirmable.
const pendingBeneficiary: WithdrawalScenario = {
  name: 'pending-beneficiary',
  title: 'บัญชีผู้รับเงินรอการยืนยัน',
  balanceState: 'known',
  balanceReasons: [],
  base: { released: '2000000', settled: '0', held: '0', sourcePeriods: openingTwentyK },
  currentPeriodPending: '700000',
  currentPeriod,
  beneficiary: { state: 'pending', reasons: ['บัญชีผู้รับเงินอยู่ระหว่างการตรวจสอบ'] },
  facts: { ...approvedFacts, beneficiary: 'unknown' },
  versions,
  deduction: { kind: 'none' },
  releasable: [],
  persistenceNote: null,
};

// Tax policy unknown: readiness blocks and the quote is unavailable — no default 0% is used.
const unknownTax: WithdrawalScenario = {
  name: 'unknown-tax',
  title: 'ยังไม่ทราบนโยบายภาษี',
  balanceState: 'known',
  balanceReasons: [],
  base: { released: '2000000', settled: '0', held: '0', sourcePeriods: openingTwentyK },
  currentPeriodPending: null,
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: { ...approvedFacts, taxPolicy: { status: 'unknown' } },
  versions,
  deduction: { kind: 'none' },
  releasable: [],
  persistenceNote: null,
};

// Balance genuinely unknown (missing source): unavailable snapshot, never a fabricated zero.
const balanceUnknown: WithdrawalScenario = {
  name: 'balance-unknown',
  title: 'ยังไม่ทราบยอดคงเหลือ',
  balanceState: 'unavailable',
  balanceReasons: ['ยังไม่มีข้อมูลแหล่งที่มาสำหรับขอบเขตนี้'],
  base: { released: '0', settled: '0', held: '0', sourcePeriods: [] },
  currentPeriodPending: null,
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: approvedFacts,
  versions,
  deduction: { kind: 'none' },
  releasable: [],
  persistenceNote: null,
};

// Known zero (all released already settled): distinct from unknown. Quote fails as not
// positive/exceeds available, never as "unknown".
const zeroBalance: WithdrawalScenario = {
  name: 'zero-balance',
  title: 'ยอดพร้อมถอนเป็นศูนย์ (ทราบค่า)',
  balanceState: 'known',
  balanceReasons: [],
  base: {
    released: '500000',
    settled: '500000',
    held: '0',
    sourcePeriods: [
      {
        periodId: 'period-2026-07',
        label: 'งวด กรกฎาคม 2569',
        releasedAt: '2026-08-01T00:00:00+07:00',
        amount: '500000',
      },
    ],
  },
  currentPeriodPending: '700000',
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: approvedFacts,
  versions,
  deduction: { kind: 'none' },
  releasable: [augustReleasable],
  persistenceNote: null,
};

// Negative correction leaves a signed deficit: available 0, deficit preserved (not cleared).
const deficit: WithdrawalScenario = {
  name: 'deficit',
  title: 'มีการปรับปรุงติดลบ (คงยอดขาด)',
  balanceState: 'known',
  balanceReasons: [],
  base: {
    released: '100000',
    settled: '300000',
    held: '0',
    sourcePeriods: [
      {
        periodId: 'period-2026-07',
        label: 'งวด กรกฎาคม 2569',
        releasedAt: '2026-08-01T00:00:00+07:00',
        amount: '100000',
      },
    ],
  },
  currentPeriodPending: null,
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: approvedFacts,
  versions,
  deduction: { kind: 'none' },
  releasable: [],
  persistenceNote: null,
};

// Cross-page demo scope. The opening balance mirrors the Overview/statement story (statement-1 of
// the closed Jul–Aug window): 37,360.00 confirmed commission was released; 11,840.00 was already
// settled (part-paid), so 25,520.00 is available BEFORE any withdrawal. These satang figures are
// the SAME authority as readyScenario().statement / demo-financials (dev/scenarios); because this
// adapter closure is import-isolated it cannot import them, so a reconciliation test keeps the two
// in lock-step. September is the open period: 7,000.00 is pending (estimated, never withdrawable).
// Reserved stays 0 until the user submits a real request through the controller (no seeded counter).
const partnerDemo: WithdrawalScenario = {
  name: 'partner-demo',
  title: 'พาร์ทเนอร์ (เดโมข้ามหน้า) — พร้อมถอน 25,520 · รอบเปิด 7,000',
  balanceState: 'known',
  balanceReasons: [],
  base: {
    released: '3736000', // 37,360.00 — statement-1 confirmed commission (released pool)
    settled: '1184000', // 11,840.00 — statement-1 part-paid settlement (retained provenance)
    held: '0',
    // Pool provenance: the released pool is exactly statement-1's confirmed earnings. Single truthful
    // mapping (amount sums to base.released), not a claim of which period funds a given withdrawal.
    sourcePeriods: [
      {
        periodId: 'period-2026-07-08',
        label: 'งวด ก.ค.–ส.ค. 2569 (สรุปคอมมิชชัน #1)',
        releasedAt: '2026-09-01T00:00:00+07:00',
        amount: '3736000',
        statementId: 'statement-1',
      },
    ],
  },
  currentPeriodPending: '700000', // 7,000.00 estimated in the open September period
  currentPeriod,
  beneficiary: knownBeneficiary,
  facts: approvedFacts,
  versions,
  // Explicit no-WHT/no-fee decision, so a 5,000 request nets 5,000 cash (available 20,520 /
  // reserved 5,000) once actually submitted through the controller.
  deduction: { kind: 'none' },
  releasable: [],
  // No persistence FAULT to report; the opening balance provenance is expressed by base.settled +
  // sourcePeriods[0].statementId (statement-1), so persistenceNote stays null (reserved for real faults).
  persistenceNote: null,
  // The opening 11,840.00 part-payment of statement-1 IS a genuine prior settlement, so it is the
  // opening "last successful withdrawal". Its net EXACTLY equals base.settled (a single part-payment
  // with no withholding/fee), which keeps it coherent with the aggregate — the coherence is authored,
  // not derived (the projection never reads base.settled as a last amount). `paidAt` reuses the
  // fixture's own recorded statement-1 instant (2026-09-01, == sourcePeriods[0].releasedAt) rather than
  // inventing a new date. A later controller-recorded paid request supersedes it by paid time.
  openingLastWithdrawal: {
    requestRef: 'wr-opening-partner-demo',
    net: '1184000', // 11,840.00 — equals base.settled (the sole historical settlement)
    paidAt: '2026-09-01T00:00:00+07:00',
  },
};

export const SCENARIOS = {
  golden,
  'partner-demo': partnerDemo,
  'applies-wht': appliesWht,
  'missing-beneficiary': missingBeneficiary,
  'pending-beneficiary': pendingBeneficiary,
  'unknown-tax': unknownTax,
  'balance-unknown': balanceUnknown,
  'zero-balance': zeroBalance,
  deficit,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;
export const SCENARIO_NAMES = Object.keys(SCENARIOS) as ScenarioName[];

export function getScenario(name: ScenarioName): WithdrawalScenario {
  return SCENARIOS[name];
}
