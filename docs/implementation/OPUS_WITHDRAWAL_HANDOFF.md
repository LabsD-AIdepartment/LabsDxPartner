# Handoff: Opus 4.8 — Withdrawal implementation

Repo: /Volumes/workspace/dev/web-apps/202609_Celeb_Collapse
Owner instruction: implement on-demand celebrity withdrawals, not scheduled payouts; plan phases/tasks before execution.
Model explicitly requested: claude-opus-4-8. Do not silently fall back to another model.

## Read in order
1. AGENTS.md, then .agent-work/context/HANDOFF.md (older review-only authorization is superseded only as specified below).
2. docs/implementation/withdrawal-payment-plan.md — full review, boundaries, invariants, section12 task backlog.
3. docs/implementation/document-system-plan.md — Portal owns issuance, but tax/issuer facts remain pending.
4. src/contracts/common.ts; current overview/statements contracts; statements/settle.ts + publish.ts; relevant tests.

## Immediate assignment: W01-A only
Build minimal withdrawal balance contracts and pure exact-balance computation using existing shared types. Add focused unit tests. Use known/unavailable states, preserve signed deficits, no float arithmetic, no inferred tax policy.
Limit edits to new withdrawal contract/domain files and associated unit tests. If changing existing contracts is necessary, report the proposal before extending scope.
No database migrations, endpoints, UI replacement, import/settlement mutations or integration activation in this first task.

## Acceptance
- released - settled - activeReserved - disjointHeld = rawAvailable; available=max(0,rawAvailable), deficit=max(0,-rawAvailable).
- Monetary totals remain exact above Number.MAX_SAFE_INTEGER; tests include satang values.
- Unknown balance never becomes known zero; invalid currency/scope/negative reservation/hold rejected.
- Demonstrate reserve400000 then settle400000+consume400000 leaves available unchanged (example initial released1000000).
- Focused unit tests and typecheck pass; source paths/commands and limitations recorded.

## Execution discipline
Node: /opt/homebrew/opt/node@24/bin/node. Run scripts/run.mjs test <new-test-file> and scripts/run.mjs typecheck.
All artifacts inside .agent-work/20260914-withdrawal-implementation; already ignored. Do not use home or /tmp for logs/cache.
Do not touch private environment/auth files or browser sessions. Do not create accounts or change passwords.
Current tree contains substantial prior dirty work: preserve it; no git reset/clean/stash, commit/push or deployment.
The owner's visible runtime is a frozen build on HTTPS4443->4210. Do not stop or replace it for W01-A.
Use mock business data only where explicitly labelled. Actual payout mode, release timing, fees/minimums and tax/issuer authority are still unanswered.
No real provider call, money transfer, official financial document issue, or production exposure.
Do not add subprocess agents or execute the entire backlog unattended.

## Review handoff
Write .agent-work/20260914-withdrawal-implementation/W01-A-result.md with files, tests, task status READY_FOR_REVIEW and remaining questions.
Stop after W01-A. Codex root independently inspects and tests your candidate, then decides acceptance; author PASS is not acceptance.
Next phases: W01-B policies -> W02 persistence/atomic reserve/reconciliation -> W03 preserved UI/queue -> W04 execution adapter -> W05 PDF/docs -> W06 cutover/release.
Blocked inputs gate dependent tasks only; no return to repeated account/login tests.

## Dispatch status (14 September 2026)
First exact-model attempt failed before execution: Anthropic profile login expired. No implementation started; model availability not yet verified. Reauthenticate Claude Code, then retry the saved bounded prompt. Do not silently substitute another model.

## D127 execution-control update
Read .agent-work/context/roadmap.md and withdrawal-review-protocol.md before execution. Root returns incomplete/defective work as CHANGES_REQUIRED to Opus on the same task; repeat corrections and independent verification until root records ACCEPTED. No dependent task may advance on author PASS or partial completion. Current per-task status is in .agent-work/context/progress.md; this document is a handoff reference, not a competing status ledger.
