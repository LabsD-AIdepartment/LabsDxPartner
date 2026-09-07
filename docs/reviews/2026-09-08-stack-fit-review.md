# Independent stack-fit reassessment

2026-09-08. Scope: revise technology-selection rationale and query-refresh planning after the owner explicitly removed any requirement to match Sale Dashboard. No application implementation or runtime migration occurred.

## Outcome and rationale

Root evaluated Next.js/React, React/Vite with Fastify, React/Vite with Hono, SvelteKit and Laravel using the portal's authentication, relational money, small operational footprint, interactive frontend and refresh requirements. Existing source-system technology receives zero selection weight. Data is obtained through scoped APIs/approved exports; no source-framework/schema/session coupling is introduced.

The initial alternative was a same-origin Vite/Fastify application. Opus judged it viable but lateral, not demonstrably simpler, and identified extra host/auth transport obligations. Root chose to retain Next.js for integrated routing/assets and maintained auth-host integration, with an explicit financial API and one interactive query owner. This is a fit judgment; no benchmark proves Next.js universally superior. SvelteKit and Hono remain fairly described credible alternatives.

## Actual independent review

The local Claude CLI uses `--model claude-opus-4-8`, read-only Read/Grep/Glob, no session persistence and project-local config/tmp/cache/evidence. Frozen candidates and SHA-256 manifests prevent review drift. No simulated reviewer persona or substitute model is presented as Opus.

| Round | Reviewed material | Result |
|---|---|---|
| 1 | Frozen initial Vite/Fastify decision, current architecture/plan as context | `REVIEW_PASS` for a defensible lateral decision; explicitly not superior to retaining Next.js. Root adopted the critique, not the proposed framework switch |
| 2 | Final independent rationale + revised architecture + plan + Thai owner guide | `REVIEW_PASS`: no decision-readiness blockers. Root independently verified the final files match the reviewed hashes |

Changes in the final candidate: no Sale Dashboard/hosting affinity; explicit single financial REST path and TanStack Query ownership; maintained Next auth handler with real all-provider proof; stack-neutral upstream API ownership; small transactional revision metadata and active-page near-realtime polling. Exact money rules, domain capabilities, visual scope and 20-task order remain intact.

## Evidence and verification

Working evidence: `.agent-work/20260907-stack-fit/` (ignored).

- `evidence/round01-decision.md`, `round01-manifest.json`, `round01.json`, `round01-review.md`: full original alternative and actual critique.
- `evidence/round02-{decision,architecture,plan,overview-th}.md`, `round02-manifest.json`, `round02.json`: revised candidates and model response.
- `analysis/round01-prompt.md`, `round02-prompt.md`: exact reviewer instructions, including permission to disagree.
- `evidence/root-checks-round02.json`: money-section identity against the previously reviewed candidate and unchanged 20 unique task IDs; document link check.
- `run-opus.cjs`: local invocation, no embedded secrets.

Older review [2026-09-07](2026-09-07-partner-plan-review.md) describes historical exact files. Its PASS is not transferred automatically to this revision. Provider callbacks, query speed, publication correctness, update latency and deployment still require their actual implementation gates. Proposed 45-second portal-commit-to-screen target is not an upstream realtime claim or measured SLA.

Authoritative documents: [decision](../design/stack-fit-decision.md), [architecture](../design/partner-portal-architecture.md), [execution plan](../superpowers/plans/2026-09-07-partner-portal.md), [Thai overview](../design/partner-portal-plan-overview.th.md).

## Root acceptance of the revised candidate

Actual response metadata identifies `claude-opus-4-8`, with no reported review error. Root checked all four current files against both frozen copies and the manifest, and all 21 local document links resolve. The unchanged money-section and 20-task checks are preserved in the separate structural receipt. Evidence: `.agent-work/20260907-stack-fit/evidence/root-acceptance.json`. These are documentation checks, not application tests.

| Document | SHA-256 |
|---|---|
| `docs/design/stack-fit-decision.md` | `aac8987c8d7b181475f689512ab1f83ebc865aa3488f76d29f5a3a67835b2694` |
| `docs/design/partner-portal-architecture.md` | `0440ac24a276cf93de9001b790346748c4a2cac43c85bac683108024b065c774` |
| `docs/superpowers/plans/2026-09-07-partner-portal.md` | `210c13f4d9336cb5afe4bac0c0e8fe2f3650b5390a5c732e43e55dc6fe29df2f` |
| `docs/design/partner-portal-plan-overview.th.md` | `d335391e43e2995558db8a5262cb604c7cb4d6f9d7286db04cec4a529d9cc43e` |

The optional reviewer notes are retained in full in `round02-review.md`: interpret framework selection as fit rather than proven superiority; keep single financial API ownership, private cache policy and real callback proof visible during A01/G04. Those constraints are already present in the reviewed candidate.
