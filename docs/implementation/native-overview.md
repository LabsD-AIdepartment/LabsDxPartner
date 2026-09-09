# Native Overview projection

The authenticated Overview now reads published earnings and catalogue presentation through `/api/v1/partner/overview`. It retains the approved cards and portrait. The reader does not expose unpublished import candidates, infer estimates or video views, or use preview fixtures as a fallback.

## Ownership and query

The maintained session and current partner membership authorize each request. `view_earnings` permits earnings; `view_statements` independently permits payout data. Requests specify the exact permission revision, an optional brand and a date window of 1–366 days. Responses are private and non-cacheable. Authentication failures hide previously displayed figures and the profile rather than retaining them with a stale warning.

One PostgreSQL data statement reads explicitly published statement generations, catalogue metadata, earnings aggregates, publication coverage, signed settlement balances and revision counters. Monetary aggregates stay decimal integer strings through SQL and JSON. Daily totals reconcile with the headline. Global unpaid sums signed statement balances before clamping and remains independent of the selected earnings period or brand.

The generation binds partner, period, brand, issued-statement revision and catalogue revision. Payment revisions update the obligation without changing the earnings generation. More than 1,000 overlapping publications or 100 brand options fails explicitly instead of silently truncating. Existing indexes and request timeouts apply; measured performance acceptance remains R01.

## Missing facts

- No published coverage means unknown earnings; a published period with no qualifying rows means known zero. Partial coverage is disclosed.
- Missing clip metadata does not remove money from the unfiltered total. Unknown top-clip presentation is omitted and disclosed. Brand filters include only matched records.
- Excluded records have no authoritative brand association, so a filtered exclusion count remains unknown when exclusions exist.
- Partner-only earnings remain unassigned to clips and brands.
- Negative statement credits reduce global unpaid, but the reader does not invent their allocation to a particular next payout. It displays an explanation until that allocation is known.

## Validation and remaining work

Local PostgreSQL tests exercise maintained credential login, source approval, import, statement publication, catalogue publication and the HTTP/client path: ten cases cover unpublished privacy, coverage/zero, filters, missing metadata, current access/capabilities, payments, integer precision beyond JavaScript Number, partner-only earnings, exclusions, original-linked negative corrections and cross-partner clip-ID isolation. The full unit suite passes 251 cases, including response profile/brand presentation and access-loss clearing. Typecheck, production build and fixture-exclusion checks pass.

Evidence: `.agent-work/20260909-native-overview/evidence/`. No migration was introduced. This is a local candidate; native HTTPS browser verification, shared Content generation/readers, broader operational performance and independent release review remain open. Source acquisition and real deployment are not implied by synthetic integration tests.
