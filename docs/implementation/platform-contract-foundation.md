# Platform contract foundation — P00

Implemented locally on 2026-09-10. This prepares staged integrations; it does not connect any real platform or add native registration persistence.

## Current behavior

Marketing registration uses a version-2 snapshot with explicit source mode and per-connection capability state. Platform choices derive from supplied connections; unavailable connections show a reason and cannot resolve/save. The synthetic authority rechecks current state at save, so a previously enabled browser snapshot cannot bypass a disabled connection. Historical associations remain visible.

The existing development preview starts with Facebook enabled in the simulation. Its separate test toolbar can select Facebook first, all simulated platforms or all disabled. These controls change mock state only. They are not native feature switches or account grants, and production fixture exclusion still applies.

## Modules and contracts

| Module | Responsibility |
|---|---|
| src/contracts/platform-capabilities.ts | Shared platform/capability identities, lifecycle contract, V2 source identity and creative references |
| src/contracts/ad-registration.ts | Versioned registration snapshot, connection/capability consistency and shared availability decision |
| src/contracts/platform-metrics.ts | Exact numeric wire values, typed metric units/aggregation, source report coverage, exact conversion/display |
| src/server/modules/marketing-ads/provider.ts | Injected read-adapter port; validate identity, reporting window, schema and cancellation |
| src/features/marketing-ads | Shared console and transport validation; derive choices from supplied connections |
| src/features/content/MetricDefinition.tsx | Shared metric card for existing V1 and exact V2 presentation |

The native provider registry is empty by default. Descriptor availability does not install an adapter, authorize an account or bypass future native staff access. P01 must bind current server authorization; P02 supplies the real read adapter; P03 owns jobs and atomic publication.

SourceIdentityV2 accepts Facebook ad identity only: version, provider namespace, connection, account, opaque object ID and capability. Its stable identity key excludes rotating connection IDs while retaining provider/account/object isolation; returned responses still must match the requested connection. Campaign, product and shop/video types are deliberately rejected until their adapters establish correct semantics. Unknown or multiple creative references are preserved, not force-mapped.

SourceReportV2 currently represents one ad-period aggregate. It carries the report/API definition, attribution/action-report timing, source timezone, requested/covered interval, fetch/source timestamps, completeness, continuation and exact metrics. It is not a daily breakdown/rollup engine. Complete acquisition requires full covered interval and no remaining page. Unknown metric values remain null with a reason, never zero. Duplicate metric keys and mixed report currencies are rejected.

Money and wide counts remain bounded strings; decimalToMinor rejects nonzero precision beyond a caller's verified currency scale. Display rounding is explicit and uses BigInt, including carry. Currency syntax validation does not prove supported currencies or exchange rates; the real adapter must verify source currency and scale. No floating-point commission calculation is introduced.

## Compatibility and rollback

Existing content endpoints retain MetricV1 via the Metric alias. Existing overview/content/finance readers therefore retain their current wire behavior. PlatformMetricDefinition is the V2 presentation entry point sharing the same card; future native queries must carry source report status/provenance and use it instead of casting V2 money to Number.

All current registration snapshot producers/consumers have moved to schemaVersion 2. Old unversioned snapshots fail closed; preview state is memory-only and reload starts a fresh snapshot. Existing synthetic resolve/save shapes retain single-ad fields during this compatibility window and are not a native V2 endpoint.

No persistent schema or data change. Roll back this local P00 code slice together if needed, preserving earlier dirty work; do not revert the whole working tree. All native integrations remain absent/OFF. Independent release acceptance remains open.

## Verification

- 318 tests across 37 unit/contract files pass, including 21 new P00 cases.
- Typecheck and production build pass; build verifies development fixtures are excluded.
- Browser at /ops-preview/ads: Shopee unavailable under Facebook-first simulation; Facebook long opaque ID resolves/saves; disabling all blocks new lookup while the saved association remains; return to Facebook-first.
- Current document client/scroll widths both measured 1016px. Screenshot capture has a cropped right edge; this is not full responsive or zoom acceptance. Mobile/200% zoom and native platform acceptance remain later checks.

P00 is a locally verified contract foundation. Next: P01 native registration/persistent mappings, then P02 Facebook adapter and P03/P04 acquisition/display. No live credentials, external API calls, scheduler, migrations, payment writes or deployment.
