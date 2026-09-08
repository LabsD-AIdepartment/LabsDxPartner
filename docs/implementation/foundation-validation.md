# F00–F02 local validation — 2026-09-08

This receipt describes author verification of a local foundation candidate. It is not independent code review or full frontend/production acceptance.

## Automated checks

After a clean `npm ci` on Node 24.18.0:

| Check | Observed result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm test` | 34/34 tests, seven files, exit 0 |
| `npm run verify:no-demo` | Exit 0 |
| `DEMO_DATA=1 npm run verify:no-demo` | Exit 1, expected rejection |
| `npm run build` | Exit 0; production browser bundles contain no fixture markers |
| Original preview hash comparison | 20/20 unchanged |
| Final production HTTP `/` on 4188 | 200, no fixture marker |
| Final production HTTP `/foundation` on 4188 | 404, no fixture marker |
| Development `/foundation` on 4187 | 200, explicitly synthetic gallery |
| Preserved original preview `/` on 4186 | 200 |

Detailed local logs: `.agent-work/20260908-foundation/evidence/2026-09-08T03-04-04.452Z-*.log` and the matching checks JSON. Timestamped HTTP JSON is in the same ignored folder. These files stay local.

Financial tests cover exact per-line and per-period rounding, signed allocation/ties, cumulative corrections, full reversals, fixed fees, large integer values and statement/settlement reconciliation. Contract tests parse seven scenarios and reject invalid monetary/status/provenance/grain combinations. Query tests cover visibility pause/abort, late/old replies, selective revisions, scope loss, backoff and cache separation. Two regression tests cover chart SSR hydration and images failing before hydration.

## Rendered checks

Used the existing single in-app browser tab at `http://127.0.0.1:4187/foundation`. Widths below are measured CSS `innerWidth`, not guessed from screenshot dimensions; the browser's pre-existing zoom sometimes differs from its viewport override dimensions.

- Measured 390, 768 and 1440 CSS px: no document horizontal overflow. Additional 720px reflow had `scrollWidth === innerWidth`.
- Day/Dark switches update the surface; moon represents current Dark, accessible label describes switching to Day. Preference survives reload.
- Export and brand controls measured 46px high after the wrapping fix.
- Export dialog opens; Escape closes and restores focus to Export. Tab and Shift+Tab cycle inside the dialog after adding explicit boundary wrapping.
- Payment sheet opens and closes. Notification opens, mark-seen removes the unread state, and notification links open the statement component.
- Six supplied content covers loaded in a 9:16 frame; measured example 276.58 × 491.68 CSS px. No desaturation filter added.
- Long Thai heading, exact large value `฿9,007,199,254,740,993.01` and missing-cover fallback are exercised in the gallery's stress card; 390px document width remains bounded. Large values wrap rather than being rounded to floating point.
- Browser found an initial chart hydration error: multiple JSX children inside SVG title. Fixed to one string, verified by server-render/hydrate regression test; no later hydration error was observed in subsequent browser checks. Browser log retained the historical original error, so an empty historical log was not claimed.
- Browser found a pre-hydration image failure that did not invoke onError. Added a mount-time complete/naturalWidth check and regression test.
- Full-page captures may show fixed navigation mid-image and viewport captures sometimes contain stale raster regions. Layout claims use settled DOM geometry plus visible checks, not screenshot pixels alone.

Saved captures in the evidence directory: `tablet-day-final.png`, `mobile-day-stress-1002.png`, `desktop-dark-1004.png`, `desktop-day-1004.png`. File labels identify capture intent; measured widths above are authoritative.

## Remaining acceptance items

- Actual native browser zoom at 200% was not established through the available keyboard controls. A 720px reflow check is not recorded as a 200% zoom pass. Complete that explicit F02 check during owner/independent review.
- Three Playwright journeys are authored in `tests/e2e/foundation.spec.ts`; the standalone runner was not used in this task. Browser checks above used the required browser runtime. CI E2E execution and broader physical-device/assistive-technology testing are not claimed.
- F00 remote/protected-main/hosted CI and independent different-model code review remain pending. Local checks do not substitute for those gates.
- No real Google/LINE/Apple login, API transport, SQL latency, production data, audio playback or end-to-end realtime measurement is covered. Those remain later tasks.

## Batch disposition

F00 local toolchain and F01 contracts are implemented and locally verified. F02 components/query support are implemented with local verification; native 200% zoom and independent acceptance remain open. F03–F08 are not implemented. Preserve this candidate on its feature branch and carry forward the explicit remaining checks rather than marking all 20 tasks or the complete frontend finished.

Final toolchain follow-up: `npm run typecheck` passed in an isolated source copy with no `.next` or `next-env.d.ts` after adding the typegen step. Evidence: `fresh-typecheck-1010.log`. This proves fresh route-type generation; it is separate from the earlier clean dependency installation. The isolated copy reused installed dependencies and did not create a second browser or server.
