# Reconciled statements and imported finance records

This extends the existing reconciled candidate importer. An authorized staff member approves an exact server-loaded source review, then publishes its current candidate as an immutable statement. A separate importer records already approved finance payments and reversals. It does not execute a transfer or issue tax documents.

## Ownership and flow

- `imports/approval-store.ts` loads source bytes and independent controls from a server-constructed `SourceReviewRepository`. The command contains a review reference and expected digest, not financial approval fields. Both evidence access and commit require a current native session with `review_imports`; commit requires recent authentication. The review is bounded and validated by the existing detailed-period parser.
- `imports/run.ts` consumes the stored approval repository, preserving fenced leases, reconciliation and atomic candidate replacement. JSON is bound as explicit text→JSONB so the same code works with the Drizzle-mutated native-auth pool.
- `statements/publish.ts` requires `publish_statements`, locks the partner/import scope, verifies the exact current ready generation and non-revoked approval, and freezes its immutable rows by reference. Publication closes the scope against re-import, records the audit receipt and advances the statement revision atomically. Competing requests create one statement. Revoking an approval later does not rewrite an issued statement.
- `statements/settlement-source.ts` defines the adapter boundary for the authoritative, already approved finance record. Its repository is server-injected. The import command contains only source record reference, expected digest and idempotency key. The UI cannot submit cash amounts through this service. Synthetic test source records are used now under the owner's mock-first instruction; an actual ERP/finance writer and adapter must be bound before real use.
- `statements/settle.ts` requires `record_payments`. It validates component totals and allocations, scopes every statement, rejects allocations above outstanding, and records payment/evidence plus allocations in one transaction. A reversal pins the original payment, negates its exact allocations and requires a reason/evidence. Only one full reversal is permitted; corrections use reversal plus a new finance record. Actual payment history remains immutable.
- `access/command-audit.ts` is shared receipt/idempotency support. Identity/access remains responsible for native sessions and current staff capabilities. Financial modules own their data; no new deployment unit or partner onboarding approval is introduced.

Each statement represents its own period obligation with zero opening balance. Prior unpaid periods remain separate obligations; they must not be duplicated as both carry-forward and original debt. Linked post-close corrections now populate the adjustment amount in a later period; negative periods remain credits in signed partner-wide outstanding and reduce the amount available for another recorded payment. No automatic debit or cash refund is executed. See [corrections and export](earning-corrections-and-export.md).

## Schema and consistency

Additive migrations0011 and0012 create immutable approvals/revocations/statements, per-partner revision metadata, external finance records and signed allocations. Source payment references are unique by authority/payor-account/reference. Composite foreign keys prevent allocations joining another partner's statement. Monetary storage uses exact `numeric(40,0)` and TypeScript `BigInt`, never floating point.

Staff mutations use the existing authorization transaction and then the partner import lock. This serializes concurrent publication, settlement and membership/grant changes. Import workers share the partner lock at commit. Partner reads do not acquire the global staff mutation lock. Native sessions/grants are rechecked inside each mutation transaction.

Migrations were applied only to the existing isolated PostgreSQL55487 binding. Old migrations remain checksum-locked. A code rollback can leave the new tables in place; no destructive database rollback was performed. No production route, real financial publication, upstream send or deployment is enabled by this checkpoint.

## Verification and remaining work

`tests/integration/statements.test.ts` uses maintained username/password authentication, real cookies/current grants, Drizzle and the isolated PostgreSQL database. It covers exact source digest, access denial before evidence load, stale/revoked staff, current-generation binding, suspended/foreign/revoked candidates, duplicate publication, immutable history, partial cash/withholding, duplicate source references, one full reversal, concurrent overpayment denial and atomic rejection of foreign allocations.

Literal fixture controls reconcile 6 rights to ฿550,000 eligible sales and ฿37,360 earnings. A ฿5,800 cash + ฿200 withholding payment settles ฿6,000, leaving ฿31,360. Reversal restores the original outstanding without deleting either record. There is no inferred withholding rate or tax calculation.

Evidence: `.agent-work/20260909-financial-statements/evidence/`. Full suite:220 unit and109 PostgreSQL tests pass; typecheck/build pass. Initial enlarged integration run hit the native login throttle because cases shared synthetic login history; per-case isolated throttle cleanup fixes the test harness without changing production policy. Earlier failure log is preserved.

G02/G03 are still partial: persistent source-review acquisition/ops HTTP composition, scoped read APIs, notifications, external private evidence delivery and production frontend transports remain. Corrections and the private CSV route are covered by the newer receipt. This receipt does not certify native browser HTTPS, real source authority, financial load/recovery or independent release review.
