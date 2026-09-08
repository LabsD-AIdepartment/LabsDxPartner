# Foundation modules and handoff contracts

Scope: F00–F02, implemented locally by one author. The complete reviewed architecture and 20-task plan remain authoritative; this document maps them to current code rather than replacing them.

## Boundaries and ownership

| Module | Public surface | Authoritative fact / invariant | Allowed dependency |
|---|---|---|---|
| `src/contracts` | Named Zod schemas and inferred types | Wire shapes, money grain, period bounds, financial status vs freshness, provenance | Zod; other contracts |
| `src/server/modules/earnings` | `commission`, `allocatePeriod`, `cumulativeDeltas`, `calculateAgreementGroup` | Exact integer arithmetic and explicit agreement rounding; caller groups by agreement/rate/currency/period | Contracts; no UI/transport/database |
| `src/shared/query` | `partnerKey`, `ScopedQueryProvider`, `ChangeWatcher`, `RevisionWatcher` | One isolated in-memory client per user/partner/permission scope; revisions trigger reads, never money deltas | Contracts, TanStack Query, React |
| `src/shared/theme` | ThemeProvider, semantic tokens | Current theme and user visual preference; no money/session data in storage | React, browser preference storage |
| `src/shared/ui` | Button/Card/Dialog/Sheet/Money/DataState/StatusBadge/FilterBar/CoverImage | Exact readable values, accessibility and stable optional-image geometry | Contracts, theme, Lucide; no server imports |
| `src/shared/charts` | TrendChart/BarChart/DonutChart | Display projections only; callers supply defined metrics and totals | Shared UI/contracts; no source/financial calculation |
| `src/features/shell` | AppShell/Navigation/ThemeToggle/NotificationButton/MusicToggle | Navigation callbacks and display composition | Shared UI/theme/contracts; no fixture imports |
| `dev` | FoundationGallery, validated scenarios | Synthetic local evidence only; never production truth | All presentation modules and contracts |
| `app` | `/`, development `/foundation` | Route/composition boundary; production gallery denial | Shared theme; phase-specific gallery alias |

No runtime/deployment unit or DB trust zone was added beyond one Next application. No module may reach directly into ERP/Sale Dashboard/ChatMesh. Changes to a public schema, rounding invariant, permission scope or generation semantics require reconciling the affected contract/tests before continuing.

## Endpoint-to-schema map

These schemas exist; HTTP handlers are not implemented yet.

| Planned route | Schema file / exports |
|---|---|
| Partner session | `session.ts`: Session, Membership, Capability, Provider |
| Changes | `changes.ts`: Changes, independent earnings/settlements/metrics/notices revisions |
| Overview | `overview.ts`: Overview, Obligation |
| Content list/detail, ad list/detail | `content.ts`: ContentListResponse, ContentDetailResponse, AdListResponse, AdDetailResponse, Metric |
| Earnings | `earnings.ts`: EarningsResponse, EarningsLine, AgreementVersion, RoundingRule |
| Statements/detail/documents/export | `statements.ts`: StatementList, StatementDetail, Settlement, DocumentRef, DownloadResponse, ExportRequest |
| Account | `account.ts`: Account |
| Notifications/seen | `notifications.ts`: Notifications, MarkSeenRequest |
| Staff invite/import/publish/payment | `operations.ts`: InviteRequest, ImportRequest, PublishRequest, PaymentRequest, OperationResult, ImportList |
| Shared filters/errors/envelopes | `common.ts`: QueryFilters, ApiError, Period, Freshness, Money, envelope/page |

Money uses THB satang as canonical integer strings on the wire and bigint during arithmetic. Unknown values remain null. Fixed-fee/bonus lines require evidence and no invented sales base/rate. Reversals refer to original evidence; future persistence must load the original agreement/group. Period allocation uses signed mathematical floors, stable source-ID tie ordering and exact conservation. Cumulative corrections compare original group allocations, including rows reduced to zero. These pure functions do not prove an importer is idempotent or a ledger is immutable.

`Overview.earnings` shares one generation across summary/trend/top content. `obligation` has a separate settlement as-of. Frozen statement examples reconcile opening + new earnings + adjustments − settled = closing, and cash + withholding + other settlement = obligation settled. Non-additive reach metrics are rejected when labeled additive.

## Client refresh and future loading order

1. F03/A03 must resolve real session and permitted partner before mounting protected content.
2. Mount `ScopedQueryProvider` with user ID, partner ID and permission revision. Old clients cancel and clear when the scope changes; no persistent financial cache.
3. F04/G04 load the critical overview before secondary content/metrics/notices. Keys include scope, revision group, route, normalized filters and financial generation.
4. Mount one `ChangeWatcher` inside that provider. The current gallery uses a synthetic loader; G04 supplies the scoped `/changes` transport and maps 401/403 to AccessLost.
5. Poll every 30 seconds plus 0–5 seconds jitter only while visible and online. Resume immediately, coalesce requests, back off errors, reject abandoned/older responses, and invalidate only changed active query groups. An access change cancels and clears caches.
6. Replace whole validated query snapshots. Never increment displayed earnings using notification/event deltas. Browser abort alone does not authorize server data; server permission checks remain mandatory.

No live API latency, SQL query plan, source freshness SLA or realtime end-to-end limit has been measured here. The existing ≤45-second portal refresh target is still a later measured target, separate from upstream delay.

## Next bounded task

F03 implements the actual route shell, `/login` provider buttons and one `/access` page with reason variants, using development fixtures behind the same production isolation. Then F04–F07 implement the full three-page experience, detail routes, account and minimal staff pages. The gallery's navigation, export dialog, date controls and payment sheet are component demonstrations, not those finished routes. Do not treat a provider button as successful OAuth; all three real providers remain A01/A03 work.

## Authority and review

Local source changes, synthetic tests, preview servers and context capture are authorized in this batch. No external message, provider-console change, live API/DB read or write, migration, remote publication or deployment occurred. Solo execution supersedes earlier worker dispatch; independent cross-model review is pending before merge. Keep the implementation branch and detailed evidence for that review.
