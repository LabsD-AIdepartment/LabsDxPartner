# Independent review: Labs D x Partner implementation plan

Date: 2026-09-07. Scope: architecture and phased implementation plan only. No application code, provider registration, live data integration, production migration or deployment was performed or accepted in this review.

Historical receipt: the 2026-09-08 owner correction reopened stack-selection rationale and added explicit refresh behavior. Current documents are reviewed in [the new stack-fit receipt](2026-09-08-stack-fit-review.md). Hashes below identify the preserved original candidate, not the subsequently revised source files.

Author/root: Codex. Independent reviewer: requested **Claude Opus 4.8**, invoked through the locally installed Claude CLI with `--model claude-opus-4-8`, read-only Read/Grep/Glob tools, noninteractive permission denial for other operations, no session persistence, project-local config/tmp/cache and write-once review outputs. Returned `modelUsage` identifies `claude-opus-4-8`; this is an actual model call, not a simulated review persona. A separate authentication research agent checked provider documentation and linking/session edge cases.

## Reviewed artifacts

- [Owner overview in Thai](../design/partner-portal-plan-overview.th.md)
- [Architecture and data rules](../design/partner-portal-architecture.md)
- [20-task implementation plan](../superpowers/plans/2026-09-07-partner-portal.md)
- Context: [reduced scope](../research/2026-09-07-partner-portal-reuse-scope.md) and [visual baseline](../design/phase-1-theme-design-system.md)

Each review consumed frozen copies with SHA-256 manifests. The authoritative files are compared with the final frozen candidate before root acceptance. Raw model JSON and full feedback remain in ignored project evidence; the summaries below do not replace those records.

## Review history

| Round | Model response | Disposition |
|---|---|---|
| 1 | Successful model call; returned text states no plan-blocking defects and gives five improvements plus two simplifications | Root applied all five and both simplifications. Returned response begins mid-list and contains no leading verdict marker; no fabricated marker is assigned to it |
| 2 | `REVIEW_PASS`; no plan-blocking findings; P1–P5 resolved | Root applied two optional wording clarifications and identified two small completeness fixes against existing agreed scope |
| 3 | `REVIEW_PASS`; no plan-blocking findings and no revisions requested | Delta review confirmed both wording fixes, fixed earnings and notifications; prior resolved findings retained. Root compared all final source hashes with this frozen candidate and accepted plan readiness |

## Findings and concrete changes

| Finding | Change | Where verified during implementation |
|---|---|---|
| P1: earnings generation cannot identify the current outstanding payment obligation | Separate earnings generation from published-statement/settlement as-of; later payment reads do not trigger an earnings-generation conflict | F04, G03/G04: payment recorded between Overview and Transactions |
| P2: per-line rounding was selected before real agreement discovery | Immutable agreement carries per-line/per-period rounding and allocation from F01; 3 vs 2 satang example and stable per-period row allocation | F01/G01/G02: signed/tie/cumulative correction tests |
| P3: Apple secret expiry and callback-cookie handling need operational ownership | Record renewal owner/date/expiry/Key ID reference, proposed 30-day renewal and 14/7-day alerts; use maintained-library transaction proof and narrow transient-cookie handling where supported | A01/R01: real Apple POST callback, expired secret, renewal runbook |
| P4: execution procedure names need resolvable instructions | Added full local skill paths and concrete checklist summaries | Plan execution procedure references |
| P5: source/agreement discovery should not wait for all auth work | G01 can run after frontend acceptance alongside A01–A03; confirmed money remains gated on proven isolation | Dependency spine and G01 |
| Simplify money rollups | Start with indexed SQL over a pinned generation; add a separate materialization only if measured latency requires it | G04/R01 |
| Simplify access states | One reason-coded access screen, not one route per error | F03 |
| Root completeness: existing scope includes approved fees/bonuses | Explicit earning kind, generic earned amount, null base/rate for fixed approved amounts, evidence and exact total tests; no contract engine | F01/G01, architecture wire contract |
| Root completeness: existing notification badge must stop being hardcoded | Derive owned statement/payment notices with one scoped seen marker and lazy loading; no messaging service | F02/G04 |

Round 2's optional wording notes were resolved: the Overview endpoint table explicitly separates obligation as-of, and performance guidance now says indexes first, rollup only if measured need remains.

## Evidence receipts

Private project-local evidence root: `.agent-work/20260907-implementation-plan/`.

- `evidence/probe.json`: actual model connection verification.
- `evidence/round01-manifest.json`, `round01.json`, `round01-review.md`: original candidate and full returned feedback.
- `evidence/round02-manifest.json`, `round02.json`, `round02-review.md`: revised candidate, actual returned model and explicit pass.
- `evidence/round03-manifest.json`, `round03.json`: final-candidate review; receipt retained even if the reviewer asks for more changes.
- `evidence/round03-review.md`: full final delta review; `evidence/root-acceptance.json`: actual model checks, matching final hashes and independent arithmetic checks.
- `analysis/round01-prompt.md`, `round02-prompt.md`, `round03-prompt.md`: exact review instructions and requested dispositions.
- `run-opus.cjs`: local reviewer invocation, no embedded credentials.

## Scope of acceptance

Plan readiness concerns whether the small portal has coherent modules, executable task order and adequate future proof requirements. It is not proof that social login works, money is correct in a running service, integrations are available or production is safe.

Phase prerequisites remain explicit: real provider/domain inventory in A01; one approved agreement and authoritative period in G01; bounded source-owner feeds in I01; measured performance/restore/isolation in R01; known Git/deployment artifact and separate exposure authorization in R02. The current preview remains a sample-data visual draft.

Root accepted the final plan within this documentation scope. All three model calls succeeded, returned `claude-opus-4-8`, and reported no tool permission denials. Round 2 reviewed overall coherence; round 3 checked the exact subsequent changes, not a fresh full-system audit. Root independently checked 20 unique task IDs, 21 local document/procedure links and the literal example arithmetic. These checks are document verification, not runtime tests.

Final source SHA-256 receipts:

| Artifact | SHA-256 |
|---|---|
| Architecture | `7aaa60b8d4eac9f3a5f55e02a2f5db984e96a94c76418b3377554751b5b517ba` |
| Implementation plan | `5c0e1277ab7336fb11130573d724ee426d40ae397c0cc4bf84aa0ee399a23648` |
| Thai owner overview | `80075175bf663cd870478d3e417117ec9ff6c59ba33be575a8dba8c2a185df0b` |

No Git commit/deployed SHA exists for this project at this checkpoint. No app source was edited; no live customer/provider/database access or deployment was used as review evidence.
