# Native content and earning detail

The signed-in Content library and clip details now read published data through `/api/v1/partner/content`. The approved layout and six vertical covers remain. Library batches append automatically on the same page; a partner does not navigate pagination to browse clips.

## One financial version

Overview and Content share the publication selection and generation function in `server/modules/earnings/publication.ts`. A financial version binds partner, selected period, brand, issued-statement revision and catalogue revision. Search and continuation change the returned slice, not the underlying financial version. Payment updates remain separate from earnings.

Each Content read uses one PostgreSQL data statement over published statement generations and the scoped catalogue. It never reads an unissued candidate as confirmed earnings. Totals are integer decimal strings; details and earning rows retain exact money, base, rate, agreement version and adjustment references. Source URLs come from reviewed catalogue metadata. Archived clips retain their financial history.

The library returns at most 50 clips per batch, ordered by publication timestamp and ID. Earning rows use earned timestamp, publication generation and a stable SHA-256 entitlement fingerprint for bounded continuation without exposing long source keys. Cursors preserve microseconds and bind current permission revision, financial generation, resource, search and target clip. Changed versions return 409 rather than mixing pages. Performance plans and load budgets remain subject to R01 measurement.

## Access and unknown data

Current maintained membership must grant `view_content`. Money and earning rows independently require `view_earnings`. The browser verifies partner, permission revision, resource, brand, search and target identifiers. Access denial clears private content. All responses are private and non-cacheable.

Publication coverage remains distinct from catalogue availability: approved covers can appear before earnings are published, with unknown amounts. Known zero requires published coverage. Partial coverage is disclosed using a shared UI component. Missing metadata does not erase Overview earnings or fabricate a clip. Excluded records are not attributed to a clip without evidence.

The current source does not supply order counts, views or ad inventory. These remain unknown; the ad section reports source unavailability rather than zero ads. Actual ad metrics and permissions remain I02 work. Multiple agreement versions remain on their individual earning rows; the detail does not select an arbitrary agreement.

## Evidence

Seventeen PostgreSQL integration cases across Overview and Content pass, using real maintained authentication, source approval, import, publication, catalogue and HTTP services with synthetic business inputs. They include 57-clip continuation, 56 earning rows with microsecond ties, exact reconciliation, filters, foreign/current access, archive preservation and stale/retargeted cursors. The shared test harness replaces duplicated setup. Unit tests pass 258 cases; typecheck, production build and fixture-exclusion checks pass.

Native production Next on loopback HTTPS was exercised with the existing synthetic celebrity account: guarded reset/login, Overview 37,360 THB, unpaid 25,420 THB, Overview → clip 9,600 THB → base 96,000 THB at 10%, library with all six covers and a one-clip Tendrix search. Native staff suspension returned the browser to login. At 1,162px, all six cover images loaded at 9:16, no horizontal page overflow was measured, and visible main text had a minimum size of 16px. This is not a native 200% zoom claim.

Evidence and complete continuation state: `.agent-work/20260909-native-content/`. No migration, upstream write, transfer or deployment was performed. Remaining G04 work includes notifications/seen and staff/source acquisition; broader native acceptance, source integration, performance, recovery and independent release review remain open.
