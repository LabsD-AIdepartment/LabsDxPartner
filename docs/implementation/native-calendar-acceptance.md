# Native calendar and layout evidence — 2026-09-11

The existing shared date inputs were verified on the native Overview page against
isolated synthetic PostgreSQL data. No product change was required.

- Keyboard ArrowUp changed the start date from August 27 to August 28, 2026.
  The URL updated automatically. Commission changed from 15,920 to 12,800 THB;
  eligible sales changed from 232,000 to 128,000 THB. Unpaid obligations remained
  37,360 THB because their scope is independent of content filters.
- Clicking the input's native date-picker button opened the calendar table.
  ArrowLeft followed by Enter selected August 27 again, restored the URL and
  restored commission to 15,920 THB and eligible sales to 232,000 THB.
- Earlier automation `fill()` failures did not prove a broken product date input.
  The real key and calendar interactions now supply the missing evidence. Clicking
  an individual day with the pointer was not separately verified.

DOM measurements covered Overview, My content, and an expanded clip-performance
detail at actual CSS widths 280, 375, and 1440 in Day and Dark: 18 distinct cases.
Measured page scroll width did not exceed viewport width, visible controls did
not exceed their horizontal bounds, and inspected control fonts were at least
16px. This is scoped layout evidence, not complete accessibility or visual approval.

The current in-app browser retained devicePixelRatio approximately 0.9 and visual
scale 1 after Meta+0 and Meta+=. Actual browser zoom to 200% was not achieved and
remains open. Captured screenshots also cropped text differently from DOM bounds;
for example Export report's text range fit inside its measured button while the
captured image cut it off. The cause remains unconfirmed. Do not use these images
as evidence of visual acceptance or change product CSS to accommodate the capture.

Raw keyboard, calendar, layout and screenshot-caveat evidence is preserved in
`.agent-work/20260911-calendar-acceptance/evidence/`. No live provider calls,
production writes, source-project changes, or new unit/build results are claimed.
The run reused the previously verified D090 production build and stopped its
owned HTTPS/Next/PostgreSQL runtime afterward.
