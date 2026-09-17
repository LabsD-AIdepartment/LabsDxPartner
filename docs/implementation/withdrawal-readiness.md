# W01-B — Withdrawal readiness prerequisites (typed contracts + pure evaluation)

สถานะ: contracts/pure-logic เท่านั้น ยังไม่มี endpoint/DB/UI/โอนเงินจริง
Author: claude-opus-4-8 · Reviewer: root · Depends on: W01-A (ACCEPTED)
Round 2: separated per-source readiness from aggregate request readiness; bound the W01-A
`BalanceSnapshot` instead of a boolean; unresolved versions/source made representable;
bounded result detail strings (findings W01-B-F01…F04).

## Purpose and boundary

W01-B models the **facts and policy prerequisites** that must hold before a partner may
*request* an on-demand withdrawal. It is deliberately NOT a tax calculator, balance engine,
request service or bank adapter.

There are **two independent concerns, two pure functions** (the round-2 correction for
W01-B-F01):

1. **Per-source entitlement readiness** — `evaluateEntitlementReadiness`: is *this one*
   earning released? It reports `released | not_released | unknown` for a single source and
   **never** determines whether other released money can be withdrawn and **never** proves a
   positive aggregate balance.
2. **Aggregate request readiness** — `evaluateWithdrawalReadiness`: may the partner request
   a withdrawal *now*? It consumes the trusted W01-A **aggregate balance snapshot** plus the
   approved payer/release-rule/tax/beneficiary configuration. It does **not** take a single
   entitlement, so a newly observed estimated/confirmed-pending/unknown source can never
   block withdrawal of money the trusted balance already reports as released.

Shared rules:

- One money authority: reuses `common.Money/Minor/Id/Instant`, the W01-A `BalanceScope` and
  the W01-A `BalanceSnapshot`. No balance formula is recomputed here; `balance.ts` remains
  the sole withdrawable engine. This module only reads the *sign* of the snapshot's already
  derived `available` minor.
- No invented production policy: no default payer, tax rate, VAT treatment, release
  maturity/return delay, fee, withdrawal minimum, transfer SLA or payout provider.
- The caller supplies authoritative current facts. Structural validity (a successful `zod`
  parse) is **not** proof of approval; approval is a declared status plus a version, an
  evidence reference and the correct scope.

## Files

| File | Role |
|---|---|
| `src/contracts/withdrawal-readiness.ts` | Typed versioned facts, per-source and aggregate inputs, deterministic result contracts. |
| `src/server/modules/withdrawals/readiness.ts` | `evaluateEntitlementReadiness` + `evaluateWithdrawalReadiness` — pure, no I/O, no policy defaults, no balance arithmetic. |
| `tests/unit/withdrawal-readiness.test.ts` | Focused behaviour tests for both functions and every finding. |
| `tests/fixtures/withdrawal-readiness.ts` | Visibly synthetic (`SYNTH-…`) fixtures, `import type` only, used by the SAME evaluators. |

## Model

### Facts (each `approved` or `unknown`)

- **PayerFact / ReleaseRuleFact / BeneficiaryFact**: an `approved` arm carries `scope`,
  `version`, `evidenceRef`; the `unknown` arm carries only `status`.
- **TaxPolicyFact**: adds `declaredWithholding: 'applies' | 'none'`. `'none'` is an
  explicit, versioned+evidenced zero-policy DECISION, deliberately distinct from the
  `unknown` arm (absence of any known policy). No rate/amount is modelled either way.
- A missing `version`/`evidenceRef`/`scope` on an approved fact fails parse.

### Per-source entitlement (earning-release readiness)

`SourceEntitlement` is a discriminated union: a **known** claim
(`scope, stage ∈ {estimated, confirmed_pending, released}, sourceRevision, amount`) or an
explicit **unknown** (W01-B-F03 — callers never fabricate a stage/revision). The
`SourceContext` carries the current scope and a **nullable** `expectedSourceRevision`.

`evaluateEntitlementReadiness` returns `{ state, stage, reasons[] }`:
- unknown source → `unknown` / `stage:null` / `source_unknown`;
- unresolved current source revision → `unknown` (the claimed stage is still reported) /
  `source_current_revision_unknown`;
- stale source revision, scope mismatch, currency mismatch, `estimated`, `confirmed_pending`
  → `not_released` with the matching reason(s);
- otherwise → `released`.

### Aggregate context and balance (W01-B-F02/F03)

`ExpectedContext = { scope, asOf, expectedVersions, expectedBalanceRevision }`. Every
expected version and `expectedBalanceRevision` is **nullable** so an unresolved current
version is representable without a fabricated Id. The aggregate balance is supplied as the
W01-A `BalanceSnapshot`.

`evaluateWithdrawalReadiness` checks:
- each fact via `expectedVersions.<fact>`: `unknown` → `unknown`; approved but expected
  version `null` → `blocked/expected_version_unknown`; scope mismatch → `blocked/scope_mismatch`;
  version mismatch → `blocked/version_mismatch`; else `satisfied`.
- the balance snapshot: `unavailable` → preserved as its own state with the snapshot's own
  `reasons` (never a fabricated zero); known-but out-of-scope → `balance_scope_mismatch`;
  unresolved expected revision → `balance_expected_revision_unknown`; stale revision →
  `balance_revision_stale`; `available ≤ 0` → `balance_not_positive`; current, in-scope and
  strictly positive → `satisfied`. Distinct codes ensure an unknown/stale/mismatched balance
  never collapses into "not positive" and never yields `ready`.

`requestGate = ready` iff all four prerequisites `satisfied` AND balance `satisfied` (i.e.
`blockingReasons` empty). `blockingReasons[]` are ordered `payer → releaseRule → taxPolicy →
beneficiary → balance`, each with a concrete code + **stable, bounded** detail. Detail
strings never embed identifiers, so valid 160-char Ids/versions cannot overflow the schema
limits (W01-B-F04).

Monthly statement publication and scheduled dates are **not** inputs; `strictObject` rejects
any such extra key, so they cannot become a readiness gate.

### How a caller composes the two functions

The future balance/quote service (W02-B) computes the trusted aggregate `BalanceSnapshot`
from all released entitlements. Per-source `evaluateEntitlementReadiness` explains why an
individual earning is or is not released (UI/audit), while `evaluateWithdrawalReadiness`
gates the request on the aggregate snapshot + approved config. A single un-released source
therefore informs the source view but cannot erase already released aggregate money.

## Source mapping — existing facts vs missing production policy

| Concern | Existing fact in repo | Missing production policy (stays `unknown`/`blocked` here) |
|---|---|---|
| Scope keys | `BalanceScope` (W01-A, `src/contracts/withdrawal.ts`) | which payer entity(ies) are live per partner |
| Aggregate balance | W01-A `BalanceSnapshot`/`computeWithdrawable` (integer satang/BigInt) | — (its snapshot is consumed as an input; only its sign/scope/revision is read) |
| Money units | `common.Money/Minor`, `earnings/money.ts` | — (reused, not re-implemented) |
| Release rule | plan §3 lists a rule *shape* | the actual contractual rule + version/evidence; maturity/return delay |
| Release stages | `statements/*` observe published amounts (plan §1) | authoritative estimated→confirmed→released mapping + source revision from the earning source |
| Tax/withholding | plan §3/§8 note WHT exists; `settle.ts` records WHT on *paid* events | whether released obligation includes VAT; the actual withholding policy/version |
| Beneficiary | plan §4/§7 describe verified, versioned beneficiaries | real verified destinations + versions/evidence |

All "missing" rows are represented as `unknown`/`blocked` dispositions; none is defaulted to
a fabricated value. Statement publication / scheduled payout dates are explicitly **not** the
readiness gate (plan §2/§3/§10).

## Unresolved production inputs (not authorized here)

Real payer/tax/release-rule/beneficiary approvals with versions and evidence; the
authoritative source-revision provenance for entitlements; VAT treatment of released
obligations; payout execution model; fees/limits/SLA. These require the owner's business
decisions and downstream tasks (W02+); this task cannot close them.

## Verification

- `node scripts/run.mjs test tests/unit/withdrawal-readiness.test.ts tests/unit/withdrawal-balance.test.ts` → 63 passed.
- `node scripts/run.mjs typecheck` → exit 0.
