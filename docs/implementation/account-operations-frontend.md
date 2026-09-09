# F07 — Account and minimal staff frontend

Local frontend candidate, 2026-09-09. This receipt covers synthetic frontend behavior only. Actual identity, staff authority, persistent writes and finance services remain A01–A03/G02–G04. Solo author verification is not independent release review.

## Implemented

- Avatar opens the account page without adding a fourth partner menu. Agreement summary, dated version/evidence, Google/LINE/Apple connection states, final-method protection, link conflict, reauthentication, recovery, support and logout reuse the partner shell and shared typography.
- Separate staff shell has partners, imports and periods. It provides invitation expiry, membership proof reference, approved agreement/content/SKU mapping, import exceptions, period publication and recording of actual payment components/evidence. It does not send invitations, transfer bank funds or issue tax documents.
- Shared `Field`, `ConfirmAction` and form styles avoid page-specific typography. Confirmation displays the partner, period, exact amounts and evidence. A review owns one idempotency key; retry reuses it, double clicks are blocked, unmount aborts and late completion is discarded.
- Account and operations own distinct injected read/action transports. Queries are separated by user/partner/permission or staff actor/permission. Actions bind the reviewed revision and target; results must match the actor/target. Frontend checks are usability/integrity checks, never a substitute for server authorization.
- Money entry converts decimal strings to integer satang with BigInt. Payment components must be nonnegative, positive in total and no greater than the outstanding obligation. Read statements must reconcile and match the reviewed period and confirmed earnings. Publication distinguishes approved exclusions from unresolved items.
- Development-only account/operations adapters simulate changes in memory. No mock authentication cookie or live source calls. Production `/account` and `/ops/*` deny access until server identity arrives; production preview aliases exclude fixtures.

## Evidence

Project-local evidence: `.agent-work/20260909-f07/evidence/`.

- `tests-final.log`: **142/142 tests in 14 files**, including 23 F07 tests. Covers foreign account/actor/revision, final unlink, conflict/recovery, exact large amounts, overpayment, duplicate submission/retry, stale review, unresolved publication, incorrect statement period, reauthentication, read-only controls and late cancellation.
- `typecheck-final.log`: Next type generation and TypeScript with `--incremental false` passed. The regular incremental cache reproduced the earlier TS7/Next generated-route `never` issue; no application types were weakened. Standard-command stabilization remains F08.
- `build-final.log`: production build and development-fixture browser-bundle exclusion passed.
- `production-http.json`: account and three staff destinations redirect to login; account and all three staff previews return 404. These HTTP checks used the preceding successful F07 build; the final model-validation-only build also passed. No hosted deployment occurred. Verification server4188 stopped; dev4187 retained.
- `responsive.json`: account Day280/800/1440 and Dark280; staff periods Day375/1440, Dark280/375; expanded partner forms and confirmation Dark280; imports Dark280. Measured minimum text16px and no document overflow. `ops-dark-mobile.png` visually inspected.
- `staff-journey.txt`: browser unlink LINE leaves Google protected; draft publication rereads published status and THB10,000 closing; changed revision and reauthentication refuse the action. Browser native datetime-local filling failed in the automation surface, so the full payment form browser journey is explicitly still pending the F08 runner; model payment proof is THB25,520 → THB15,520 after cash9,700 + withholding300, with earnings37,360 unchanged.
- Three new standalone E2E cases in `tests/e2e/account-ops.spec.ts`, **17 total authored; standalone runner not executed in F07**. Native200% zoom, complete route/state matrix and independent/owner acceptance remain open.

## Integration handoff

A01/A02 replace simulated identity actions with real provider linking, known-contact membership verification, fresh staff authorization, revocation and durable audit. G02/G03 own idempotent import/publication/settlement. Server operations must atomically check current capabilities, reviewed revisions and exact request fingerprint, retain operation status for uncertain responses, and never trust submitted proof-reference text as verification by itself. The current pending dialog suppresses repeat submission while awaiting completion; durable status recovery belongs to that service integration.

`OpsSnapshot` is a bounded frontend workspace projection with page cursors and lookup metadata. It is not an instruction to read entire source databases or grant broad staff access. F08 freezes the screen-to-endpoint mapping before production adapters replace it.

No upstream project changes, migration, credentials, external send, push, merge or deployment in this batch. The approved overview/content imagery and layouts remain.
