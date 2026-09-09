# Native staff period review and publication

The native `/ops/periods` page lets finance staff search a partner, inspect the already-reconciled period and its income/exclusion evidence, choose the payment date, and review an exact statement before publication. It uses the existing statement publisher. Browser commands carry approved generation and approval references, never replacement money totals. This is a local candidate behind the existing finance runtime flag.

## Ownership and behavior

- `staff-finance` owns the bounded read projection and staff presentation. Existing imports, statements, allocations and source approvals remain authoritative.
- Reads require a current `publish_statements` grant and expected staff revision. A finance-only user does not also need partner-administration rights. Native reauthentication returns to the concrete `/ops/periods` destination.
- One SQL snapshot returns period data and, for an explicitly selected partner/scope, income and excluded rows. Money stays integer decimal text. Period and line pages use 20-item keyset continuation; cursors bind the actor, revision, search, partner and immutable detail generation. Search treats wildcard characters literally.
- Publication requires fresh authentication and the same staff revision inside the owning transaction, followed by existing approval, current-generation, correction-history and exact-sum checks. A review freezes the generation/approval/date; retries reuse its idempotency key. Old direct service callers remain compatible with the additive optional revision field; HTTP requires it.
- The console reuses StaffShell, typography, money, fields, cards, loading/error states and ConfirmAction. Errors hide old private data; hidden-page unmount clears its isolated query cache. Partner-facing layouts and fixtures are unchanged.

## Verification on 2026-09-09

- 267 unit tests in 34 files, including confirmation/reauth retry and concrete staff return-path checks.
- 149 PostgreSQL integration tests in 15 files. Seven new finance cases cover exact rows/publication/replay, current capabilities and revisions, stale generation/revoked approval, CSRF and injected amounts, bounded filter-bound continuation, timestamp ties/client serialization, exclusions and fresh authentication.
- Typecheck, production build and production fixture exclusion passed.
- Native trusted HTTPS browser on the isolated database: staff login returned to `/ops/periods`; searched a newly created synthetic partner; inspected six rows totaling THB37,360; selected 15 September2026; reviewed and confirmed. The UI showed published, settled THB0, remaining THB37,360. Database verification found one statement on the exact reviewed generation and one notice. No existing trial payment/history was changed.
- Full evidence: `.agent-work/20260909-native-period-ops/`, including native DOM/screenshots and database verification.

## Remaining scope

Source review/acquisition, reviewed catalogue delivery and source-owned settlement ingestion are separate next slices. This page does not add a manual payment ledger or claim that ERP/API acquisition is complete. External agreement/evidence delivery, remaining native accessibility/zoom checks, I01/I02 feeds/ad metrics, load/recovery and release acceptance remain open. No new migration, production deployment, real payment, customer message or independent release acceptance occurred.
