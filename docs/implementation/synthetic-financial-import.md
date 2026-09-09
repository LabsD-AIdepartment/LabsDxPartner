# G01/G02 — Synthetic financial candidate import

D036, 2026-09-09. Implements the owner's instruction to mock the partner/deal using the owner as the celebrity. This is executable local data work, not evidence of a real agreement, a source integration, or authority to publish money to a real partner.

## Chosen development input

The existing approved-period/1 detailed entitlement snapshot is the synthetic source grain. The six sample rights stand for six example clips; they are not recovered customer orders. `dev/financial/celebrity-period.ts` supplies source rows and literal finance control totals. Its mock approval repository is available only through the explicit synthetic CLI and tests, never through an upload or production API.

| Clip | Channel | Eligible base THB | Rate | Commission THB |
|---|---|---:|---:|---:|
| 1 | Organic | 128,000 | 10% | 12,800 |
| 2 | Brand ads | 104,000 | 3% | 3,120 |
| 3 | Organic | 96,000 | 10% | 9,600 |
| 4 | Brand ads | 86,000 | 3% | 2,580 |
| 5 | Organic | 74,000 | 10% | 7,400 |
| 6 | Brand ads | 62,000 | 3% | 1,860 |
| Total | | 550,000 | | 37,360 |

Synthetic period: July 1 through September 1 exclusive, Asia/Bangkok. Source data through September 1 at noon Bangkok. Base values are already eligible source bases; these inputs do not infer VAT, shipping, discount or collection rules for a real agreement. Synthetic rounding is per-line, half-away-from-zero. Organic controls are 29,800,000 base satang / 2,980,000 commission satang; ads controls are 25,200,000 / 756,000. No fixed fees or bonus is in the default demo; separate integration cases verify those evidenced earning kinds. The existing 25,520 unpaid amount also depends on settlement records, which this importer does not create.

## Ownership and execution

`createImportRunner` consumes a server-owned ApprovalRepository, the raw snapshot and a command key. An approval record supplies its independently ordered sequence and existing ApprovalContext; the file cannot grant its own approval. The sequence orders complete snapshots for a partner/period; opaque per-row and source revision strings remain evidence, not lexical timestamps.

Migration0009 adds portal_imports scopes, runs, immutable generations and earning_rows. Existing migrations0001–0008 remain untouched. The worker claims a five-minute fenced lease using database time, parses outside a database transaction, then commits rows and the internal current-generation pointer together. An expired worker cannot commit over its successor. Partner-level locks serialize overlapping scope creation and cross-period entitlement checks. Rows are inserted in batches of500; indexed generation/time/content paths prepare later bounded reads without daily rollups.

Current generations are internal reconciled candidates. They do not mean an issued statement or a published partner amount. Failed schema/control/calculation checks and unresolved/original-history blockers leave the last good pointer intact. New open-period snapshots replace current candidates; old generations remain immutable. Same-command retries return the prior result, while changed bytes/context under that command conflict. Older approval sequences, overlapping periods, duplicate rights in another current period, suspended partners and closed scope rewrites are rejected. A failed database transaction rolls back its generation and rows and only releases its own lease.

## Local command

With the project-owned isolated PostgreSQL cluster running and migrations applied:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test \
/opt/homebrew/opt/node@24/bin/node scripts/run.mjs import:once --synthetic
```

The command verifies the isolated database name/port/data directory, creates only the named synthetic partner, and prints a receipt. Repeating it returns the same run with replayed=true and unchanged totals. Running without explicit --synthetic refuses execution. No real source/database binding is inferred.

## Verification and remaining work

Isolated PostgreSQL tests exercise literal totals, same-command replay, changed-command conflict, same-period revision/refund-once, prior-generation preservation, concurrent claims, expired-worker fencing, cross-period duplicate rollback, immutable rows, incomplete input, explicit zero periods and fixed-fee/bonus persistence. Existing complete access/identity integration tests run against the expanded schema. The original frontend has not been rewired by this batch.

Still required for the full plan: authenticated persistent approval records; real source-contract confirmation when requested; closed-statement delta linkage rather than rewriting history; statement/settlement persistence and private exports; scoped read APIs and changes metadata; a real worker binding/scheduler; measured load/restore/native HTTPS/release acceptance. G02 is a partial local candidate, not complete publication acceptance. No extra approval ceremony is added to the celebrity signup flow.
