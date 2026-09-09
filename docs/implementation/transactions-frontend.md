# F06 — Transactions frontend

Local implementation candidate, 2026-09-09. Solo author verification; owner acceptance and independent implementation review remain open. This implements the F06 frontend scope in the [canonical plan](../superpowers/plans/2026-09-07-partner-portal.md), using explicitly synthetic development data. Real authentication, source integration, private files and financial publication remain A01–A03/G01–G04.

## User journey

- Transactions lists statement periods and statuses, with an independently supplied all-period unpaid balance. Filtering paid statements does not turn that balance into zero. Page controls appear only when the source has another page or the user has already paged.
- Statement detail separates earned period, publication, planned payment, actual payment and recording time. Unknown planned/actual dates remain unknown.
- The balance bridge explains opening + newly confirmed earnings + adjustments − settled obligation = closing. Payment history separates cash, withholding and other settlement, with references and dates. Negative balances show credit carried forward.
- Earnings and adjustment details expand for source, agreement version, eligible base/rate and original adjusted line. Summary amounts are server-supplied, never recomputed from the visible page for display.
- A chosen document is prepared only on request, then downloaded explicitly. Pending, error/retry, ready, denied and expired states are distinct. Example CSVs are marked synthetic, include exact minor units, and payment evidence includes the selected payment's components and timestamps. No real tax document is fabricated.
- Ask-about-this-statement displays its reference, version, period and balance for the existing contact channel. An optional configured HTTPS support link is supported; no message is sent automatically.
- Existing shared shell, theme, typography, notification button and components are reused. No Overview portrait, covers, charts or approved layout is removed. Minimum text remains 16px.

## Module and contract ownership

`src/features/transactions/` owns `StatementList`, `StatementDetail`, `SettlementBridge`, `DocumentList`, state rendering, CSS and the validated injected transport boundary. Shared UI/theme owns all text presets, money formatting, cards, buttons, dialogs and status labels. No dependency on the development fixtures exists in the feature module.

Additive contract changes in `src/contracts/statements.ts`:

- `Statement.scheduledAt` and `Settlement.paidAt` are nullable with a null default, preserving existing fixtures without inventing dates.
- List/detail response envelopes include freshness and an independent `settlementsRevision`; list supplies `asOf` and `confirmedUnpaid` for all periods. Statement version and earnings generation do not pin later settlement facts.

The model parses responses, validates exact BigInt financial invariants, statement/document identities, duplicate IDs, status consistency, revision/version changes, aborted responses and immediately repeating cursors. Complete first pages reconcile line/settlement totals; partial pages do not pretend to prove completeness. General multi-page endpoint behavior and longer cursor cycles remain integration/acceptance work; the development adapter serves complete finite pages.

Query keys include user, partner, permission revision, resource, filters/cursors and settlement revision. Refresh resets pagination and uses a fresh key so recovering a changed revision cannot immediately reuse the old first page. Prepared documents abort/dispose on scope, version or adapter changes; expiry is checked before delivery. These are frontend consistency safeguards, not server entitlement checks. G03/G04 must enforce membership, document ownership, immutable statement versions and signed file authorization independently.

`DocumentTransport` owns preparation and delivery. `signedDocument` validates the existing HTTPS download contract for a future HTTP adapter; it is not yet connected to a server. No object-storage provider, credentials or document service was added.

## Development and production boundaries

`dev/TransactionsPreview.tsx` and `dev/transaction-transport.ts` bind the feature to scenarios at `/transactions-preview` and `/transactions-preview/statement-1`. A development-only session-storage payment switch is shared with Overview to demonstrate a later payment across navigation. It is not production financial state.

Overview's payout links retain reporting date/brand/generation inside a safe return destination while Transactions fetches the latest settlement state. Production defaults remain `/transactions`; preview targets are injected only by development harnesses. List/detail production entry routes require partner access and currently redirect to login until real sessions land. Production aliases and route guards exclude preview fixtures.

## Author verification

Evidence: `.agent-work/20260909-f06/evidence/`.

- 119/119 tests in 13 files pass, including wrong ownership/version/revision, inconsistent bridge/components/lines, partial payments, correction/credit, denied data, aborts, late file responses, expiry, safe returns and generated sample CSV values. Typecheck and production build/fixture exclusion pass.
- Browser: Overview filtered Axtion shows earned ฿15,920 and all-period unpaid ฿25,520. Its statement shows earned ฿37,360. A simulated ฿10,000 payment recorded after the period changes settled ฿11,840→฿21,840 and closing ฿25,520→฿15,520. Returning preserves Axtion, dates, generation and earned ฿15,920 while unpaid remains the new ฿15,520. `journey.json` records snapshots.
- Browser: paid-only list retains unpaid ฿25,520; statement credit displays −฿2,640 with −฿40,000 adjustment; forbidden state hides amounts. Chosen document reaches ready, denied hides its action, expired produces retry. Support dialog opens on a 280px viewport. No external message or native download was triggered; download delivery and sample contents were verified in tests.
- Responsive DOM checks cover list 280/375/800/1440 and detail 280/375/800/1162/1440 across Day/Dark, plus 280px support dialog. Minimum measured font 16px; no document or visible text overflow. Dark screenshot inspected; saved screenshot compositor may clip the long page. DOM and interaction evidence are separate.
- Local production build on 4188: `/transactions` and `/transactions/statement-1` return 307 to login. Transactions list/detail preview, Overview preview and Content preview return 404. Development fixture markers are absent from production browser bundles. This is local build verification, not deployment.
- Three additional standalone E2E cases are authored (14 total). The standalone E2E runner/hosted CI was not run; the interactions above used the permitted in-app browser. Native 200% browser zoom is still unproven. No independent implementation review, real SQL performance, realtime latency, auth or upstream reconciliation is claimed.

## Next

F07 account and minimal staff frontend, then F08 complete frontend acceptance/contract freeze. Preserve solo execution and existing design. Identity, real money ownership, source feeds, database/query measurement and release remain later plan gates. No remote push, merge, migration or deployment is part of this batch.
