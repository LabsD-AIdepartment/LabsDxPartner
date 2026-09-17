# Report filters and navigation

Overview and My content use one editable report state for controls, native requests
and menu links. The shared `useReportState` hook also backs their development
previews. Valid filter changes update the current URL while preserving Next.js
history metadata, so reload retains the selected range, brand and content search.
Invalid date drafts remain editable; query validation blocks requests for them.
Route, identity, permission and initial URL changes reset local edits before render.

Overview's optional controlled filter interface accepts only its three filter
fields. Content search retains its 250ms debounce and composition handling. Both
query keys change automatically; Content's redundant reset and manual-refresh
controls have been removed. Error retry, export, search submit, continuous clip
listing and native ChangeWatcher remain.

`reportNavigationHrefs` carries date/brand filters between reports. Overview does
not consume a clip-search term. Top-level navigation clears generation/cursor
state so a detail snapshot is not silently reused for a different report. Detail
links still use the response generation. Transaction navigation carries a return
link; payout amounts remain governed by the separate financial read service.

## Verified 2026-09-11

52 tests across report state, native application, content and overview passed with
pinned Node 24.18.0. TypeScript, optimized build and development-fixture exclusion
passed. An independent read-only review found no issues in the frozen candidate.

Native HTTPS browser verification used an isolated synthetic partner: selecting
Axtion updated commission to 15,920 THB and eligible sales to 232,000 THB, while
the global unpaid amount remained 37,360 THB. Overview → content → reload retained
July 1–September 1 exclusive and the brand. Partial search produced one matching
clip, and returning to Overview retained the report filters. At actual CSS width
375, both Day and Dark had no page/control overflow and inspected inputs were 16px.

The browser automation's date-fill operation changed the DOM value without
committing React state in this run. Date change/query/URL alignment is covered by
component tests; actual calendar interaction and exact 200% zoom still need browser
acceptance. This record is not a claim of those checks, load performance, full
transaction-detail navigation parity, live provider connectivity or deployment.
