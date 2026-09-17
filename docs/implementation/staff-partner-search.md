# Staff partner directory search

The native staff account page (`/ops/access`) now searches partner names while typing. Marketing can find a partner beyond the first directory page without paging through unrelated names. The existing shared Field and typography/theme tokens render the control; partner-facing layouts are unchanged.

## Behavior and ownership

- The optional `StaffAccessQuery.partnerSearch` is trimmed and capped at 100 characters. An empty value retains the existing directory behavior.
- The authorized staff reader applies a parameterized, case-insensitive literal substring comparison to partner names before the existing ID cursor and 51-row query limit. It returns at most 50 choices and the next cursor. `%` and `_` remain literal characters; there is no wildcard input language or new total-count scan.
- Typing waits 250 ms before requesting the latest term. During that interval the prior choices and selected partner details are hidden immediately. Changing the search clears pending drafts, issued-link display and feedback. Committing a new term resets the selected partner and all three page cursors.
- Paging retains the search. A new term is a separate query key; the request keeps its AbortSignal and existing staff/partner response checks. A late response for an earlier term cannot replace current results. Search never selects a partner or submits an invitation automatically.
- Existing staff authorization and permission-revision checks remain mandatory. Search exposes no additional metadata or credential fields. Membership, invitation, reset, agreement, finance and provider ownership are unchanged.

## Local verification — 11 September 2026

Eight unit cases passed, including immediate stale-choice/detail removal, selection reset, clearing input, and an old response arriving after the current empty result. Three focused PostgreSQL/API cases passed (11 unrelated cases skipped), covering literal special characters, Thai/Latin matching, matches beyond the first 50, continued pagination, 100-character validation, unauthenticated requests and stale staff revisions. Full typecheck and isolated production build/fixture exclusion passed. An initial test-only SQL-helper overload typing error was fixed by using a named row array without a type cast; the failed log is retained separately.

Native HTTPS verification used the existing marketing test account and shared test database: type `ดาราทดสอบ`, receive `คุณ · ดาราทดสอบ`, open its existing members; change to an unmatched name and immediately hide the old details; show no-result feedback; clear input to restore the directory without retaining the prior selection. No business command was submitted. Final page is `/ops/access`, Day, with the test partner selected.

DOM measurements at actual CSS widths 280 and 375, in Day and Dark, showed no document horizontal overflow, visible controls within the viewport, control text at least 16 px and no internal control overflow. These are geometry checks, not native 200% zoom or complete visual acceptance. The browser screenshot output still exhibits the previously observed clipping discrepancy despite the measured control bounds; no screenshot-perfect claim is made. Final normal viewport is 1016 CSS px, with no console errors reported.

Warm local SQL-only measurement on the existing 812-partner synthetic directory used one connection and 30 sequential samples per term. P95 was 0.415 ms for no match, 0.395 ms for the matching Thai term and 0.732 ms for the empty term. This is not an HTTP load test or a production capacity claim. No index or migration was added; substring matching can scan the directory and should be remeasured against actual growth before considering a search index.

## Runtime and evidence

Source, tests and build are frozen in `.agent-work/20260911-partner-search/`. The local TLS wrapper serves build `HkQl68SnTlmXEbuPR0rGu` through HTTPS 4443 to Next 4203. All 337 app/src files match the frozen build. The previous D114 build is retained and its listener was stopped before the switch. Existing 4186/4187 and another project's 4191 listener were not changed.

The initial `native.json` clear-step capture was mislabeled: the browser fill-empty operation left the prior text in place. Independent review caught this. `evidence/native-cleared.json` supersedes that step and records actual keyboard selection/deletion, empty input, restored 50 names plus paging, and no selected details. The original capture remains historical evidence.

Evidence includes `evidence/candidate-code.json`, `evidence/build-verification.json`, `evidence/native.json`, `evidence/query-timing.json` and accepted logs in `logs/`. The contract and client must ship together: the previous strict server does not accept the new field. Old clients can continue omitting it. Local rollback is a code/build rollback with no data migration.

Production release, continuous worker monitoring/alert delivery, off-device backup, final browser file-save and native zoom/mobile LCP checks, and real platform access remain separate open work. This change does not claim those are ready.
