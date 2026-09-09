# Labs D x Partner — Phase 1 Theme Design System

Version: 1.0 · Captured: 2026-09-07 · Status: current local visual baseline for owner review.

This document describes the implemented appearance and interaction choices of the Celeb Collapse partner dashboard. It consolidates the owner's iterative direction; it is not a claim of production readiness or a newly approved backend plan. Values below come from the current source files. Existing Day styling is the preservation baseline; Dark is an alternate theme of the same system.

## 1. Product and visual intent

A celebrity partner should be able to understand their own clip sales, commission and payout status quickly. The visual language combines a quiet canvas, rounded cards, strong financial figures, real portrait photography and selective green accents.

- Brand wordmark: **Labs D x Partner**, including the lowercase letter `x`.
- English navigation and short display headings; Thai explanatory labels and supporting copy.
- Use the reference images for color, depth and composition, not their promotional copy or decorative objects.
- Preserve readability and meaningful data grouping. Avoid dense tiny text and excessive green surfaces.
- Make incremental changes against this baseline. The earlier wholesale Thai/plain redesign and broad green repaint were rejected.

## 2. Scope of Phase 1

| Included in the visual prototype | Not implemented as a real service |
|---|---|
| Overview, My content, Transactions | Authentication, authorization and celebrity account isolation |
| Six sample clips, date/brand filters, search, detail dialogs | Live sales ingestion and commission calculation contracts |
| Day/Dark switch, remembered choice, entrance motion | Real notifications, payment execution and ledger reconciliation |
| Responsive layouts and supplied cover images | Report file export, production deployment or monitoring |
| Background music toggle | Independently hosted audio or a verified music license |

The current data is demonstrative. Its labels, dates, sample rates and payout statuses must not become authoritative business rules by copying the UI.

## 3. Theme foundations

Theme is set through `html[data-theme="light"|"dark"]`. Day is the first-visit default. An explicit choice is stored under `labsd-theme`; storage failure must not break the page. Both themes retain the same content and layout.

### Semantic colors

| Role | Day | Dark (latest dimmed version) |
|---|---|---|
| Canvas | `#ececea` | `#030806` |
| Base card token | `#f9f9f7` | `#090f0c` |
| Actual standard card surface | Base card | `linear-gradient(145deg, #0b130e, #080e0b 65%)` |
| Main text | `#272925` | `#eff7f0` |
| Secondary text | `#5f6558` | `#a4b8aa` |
| Separator token | `#e4e5df` | `#2b3d32` |
| Standard card border | `#ffffff8c` | `#2a4133` |
| Secondary controls | `#f5f5f2` | `#0c1410` |
| Heading accent | `#62695b` | `#7ee5a1` |
| Profile earnings surface | `#fafbf6dc` | `#09110d` |
| Payout surface | `135deg, #f9faf4 → #f1f3ea` | `135deg, #0d1a12 → #08100b` |
| Clip tile | `#ffffff` | `#0b140f` |
| Pending badge | `#e5e9d7` / text `#596442` | `#181d13` / text `#d5dfaf` |

Dark canvas also uses two restrained radial glows: `#071c1280` at `5% 0%`, and `#05170e50` at `95% 70%`, each fading to transparent at 42%. These are background layers, not overlays on page content.

The latest owner adjustment reduced low-valued dark surface RGB channels by roughly half. This is a source-color adjustment, not a measured 50% reduction in physical screen luminance. Text and bright chart accents were preserved. Never apply `filter: brightness(.5)` to the entire page.

### Green accents and depth

| Component | Treatment |
|---|---|
| Highlighted sales bar | `linear-gradient(120deg, #a3ef89, #68df60 35%, #32c96b)` |
| Clip commission panel | Same three-stop green gradient; dark text `#103d22` / `#214d2b` |
| Notification count | Same gradient; text `#103d22`, circular 26px badge, 14px/700 count |
| Completed payout steps | `linear-gradient(90deg, #99e887, #2db963)` |
| Dark active navigation / primary payout action | `linear-gradient(120deg, #9aef82, #31cf6e)`, text `#083b20` |
| Day active navigation / primary payout action | Charcoal surface, white text |
| Bar dimensionality | Subtle inset highlight and low-opacity green shadow; no full-page glow |

Inactive bars retain diagonal hatching rather than using equally bright solid green. On Dark, surfaces and borders separate cards; green glow is confined to important accents.

## 4. Typography and copy

| Role | Family / weight | Size and behavior |
|---|---|---|
| Header, wordmark and navigation | Inter; Thai fallback Noto Sans Thai | Header-scoped Inter, not a whole-app replacement |
| Body and data | DM Sans, Noto Sans Thai, sans-serif | 16px body; typical line-height 1.6 |
| Wordmark | 800 | 40.32px desktop; 37.44px at ≤720px; 28px at ≤350px; tracking -1px |
| Main page title | 550 | `clamp(30px, 4.1cqi, 48px)`; line-height 1.2 |
| Main page title on phones | 550 | `clamp(30px, 8cqi, 36px)`; tracking -1.2px |
| Card headings | 550 | 20px / 1.4; tracking -0.4px |
| Clip titles | 500 | 16px; wrap naturally |
| Main commission figure | 500 | 46px desktop; 42px narrow Overview |
| Sales / pending payout figures | 500 | 38px desktop; 36px tablet arrangement |
| Trend figure | 500 | 36px desktop; 34px narrow |
| Supporting text and chart labels | Regular / medium | Minimum design target 14px; do not shrink to force fit |

Google Fonts currently supplies the fonts. The declaration is verified in source; font availability remains an external dependency.

Current main titles have **no periods**:

- Overview: `Your content Your impact`
- My content: `Create Share Get rewarded`
- Transactions: `Your earnings All clear`

The selected lower-card title is `Small clips Real results`, also without periods. Other copy still contains periods (for example `Every clip counts.` and `Made by you.`); their removal was not part of the latest edits.

No breadcrumb or top-level sample-data badge above the filters. Preserve contextual demo disclosures in the footer and relevant dialogs. The small decorative rail line is removed; an invisible spacer preserves navigation placement.

## 5. Layout and components

### Shell

- Workspace maximum width: 1680px, centered.
- Desktop main left inset and header left inset: 108px. Wordmark begins on the same vertical line as the page title.
- Desktop main right inset: 38px; header height: 100px.
- Header right controls: theme switch, notifications, profile avatar.
- Filter order: period, All brands, Export report, reset. All brands and Export report share 152px × 46px desktop dimensions; widths become fluid in narrow layouts.
- Standard card radius: 27px; narrow Overview cards: 22px. Standard internal padding: 24px, generally 20px on narrow cards. Main grid gaps: 14px, with responsive 12–16px variations.
- Interactive circles and primary controls target at least 44px touch height. Music toggle: 48px.

### Overview

Desktop composition:

1. Left column: profile cover and commission summary spanning two rows.
2. Upper right: Sales in motion and Your next payout.
3. Lower right: full-width line chart.
4. Lower section: top-earning clips and earning-mix donut.

Source order is partner → sales → payout → trend, so smaller layouts follow the same priority.

### My content

- Responsive grid: `repeat(auto-fit, minmax(min(100%, 260px), 1fr))`.
- Each card contains a portrait cover, clip title, date/views and green commission panel.
- Cover container is **9:16**, cropped using `object-fit: cover`, never stretched.
- Six supplied images map to sample clip IDs 1–6 in upload order: `assets/clip-cover-1.png` through `clip-cover-6.png`.
- Most cover positions are `50% 50%`; clip 5 uses `43% 50%` to favor the product and face.
- Image pixels are copied unchanged; cropping happens in CSS. Existing text/UI captured inside the source screenshots remains part of those images.
- Library photos have no desaturation filter. Top-clip rows use the matching cover asset but retain the older small-thumbnail saturation rule; this is a known remaining inconsistency, not a new approved visual rule.
- Large profile cover stays `assets/celebrity-thumbnail.png`; small account/profile avatars stay `assets/celebrity-avatar.png`. Do not interchange these with clip covers.

### Transactions

Desktop uses a table with clip/brand, date, type, commission and status. Pending/paid summaries precede it. On narrow containers, the same rows become labeled cards; retain fields and accessibility roles rather than maintaining a second copy of the data.

### Theme, notification and dialogs

- Theme icon represents **current mode**: sun for Day, moon for Dark. Accessible label describes the action to switch to the other mode; `aria-pressed=true` means Dark.
- Notification badge shows the sample array length (currently 3), hides at zero, and caps display at `99+`. This is not an unread/read backend.
- Dialogs support close button/backdrop dismissal, focus return and scrolling within the viewport.

## 6. Charts

### Commission line

- Smooth cubic segments with controls at the midpoint X and each endpoint's Y. This preserves measured endpoints without curve overshoot.
- Stroke: 1.8px, rounded caps/joins, horizontal gradient from left `#ccf66a` to right `#32c96b`.
- Gradient coordinates use the SVG's plot bounds so it stays left-to-right when resized or filtered.
- Area underneath remains a vertical lime fade: `#ccf66a` at opacity .18 → .07 at 60% → 0 at 100%.
- Peak value tag remains lime `#ccf66a`. Preserve existing markers, axes, values and labels.
- SVG is generated at actual container width with 180px height. Skip date ticks when narrow instead of reducing the 14px label font.

### Brand sales bars

Highlight the highest sales total with the green gradient; other bars are hatched. At sales-card container width ≤290px, reshape into horizontal bars with readable labels. Tooltips expose exact values.

### Earning mix

Conic gradient uses `#92ed7e → #40d26a → #119b5c` for Organic and `#073d30` for Brand ads. Percentage comes from the sample sums; the ring has restrained dimensional shading. Dark uses a dark center and light percentage text.

## 7. Responsive rules

Use viewport size for the shell and **available container width** for cards; do not scale the desktop page down as a bitmap.

| Trigger | Behavior |
|---|---|
| Viewport ≤1100px | Hide rail; main/header use 24px horizontal spacing |
| Viewport 721–1000px | Header navigation moves to second row |
| Viewport ≤720px | Fixed bottom navigation, safe-area padding, main 16px horizontal inset, wrapping wordmark |
| Viewport 351–420px | Smaller header gaps accommodate three right controls |
| Viewport ≤350px | Wordmark 28px; header controls wrap to another row; main inset 12px |
| Overview container ≤1040px | Horizontal profile summary, sales/payout pair, full-width trend, stacked lower section |
| Overview container ≤620px | One column; profile cover 210px tall; simpler clip rows |
| Filters container ≤1000 / 620 / 340px | Fluid grid → date on own row → reset on additional row |
| Library container ≤660px | Search occupies a full row |
| Payments container ≤900px | Table rows reshape into cards |
| Payments container ≤440px | Summary cards stack |

Keep content free of horizontal overflow and controls reachable. The existing responsive matrix predates later theme/header/cover edits; recent checks were targeted, not a new full device acceptance matrix.

## 8. Motion and audio

Motion is enabled only for `prefers-reduced-motion: no-preference`. Complete static content is visible otherwise.

- Header reveal: 420ms; page/card entrances: roughly 380–560ms with short stagger.
- Line drawing: 850ms; area reveal: 700ms; bar growth: 700ms; donut reveal: 750ms.
- Dialog entrance: 220ms; hover feedback: about 180ms.
- Do not count financial figures up from zero, loop chart motion or animate in ways that change the apparent data.

Background music is an icon-only floating toggle. Default intent is sound enabled at volume 25; if browser autoplay is blocked, retry after user interaction. Manual mute must be respected. The prototype currently uses YouTube video `E6NpWspc8x8` through an offscreen iframe. Actual audible playback, browser/provider restrictions and licensing require separate validation before production; a loaded player or an enabled icon is not proof of sound output.

## 9. Source map and maintenance

Load order matters because the prototype contains historical overrides:

`style.css → green-theme.css → responsive.css → motion.css → music.css → dark-theme.css`

| File | Responsibility |
|---|---|
| `design-preview/index.html` | Structure, shared shell, static headings, profile images |
| `design-preview/style.css` | Base Day styles and typography overrides |
| `design-preview/green-theme.css` | Green accents and content/transaction treatments |
| `design-preview/responsive.css` | Final layout rules, container behavior and 9:16 covers |
| `design-preview/dark-theme.css` | Dark colors plus theme-control responsive adjustments |
| `design-preview/theme.js` | Initial theme, toggle, metadata and persistence |
| `design-preview/app.js` | Sample data, filters, charts, page headings, dialogs |
| `design-preview/motion.css` | Reduced-motion-aware animation |
| `design-preview/music.js`, `music.css` | Audio toggle and player integration |
| `design-preview/server.mjs` | Local preview; explicit route allowlist |

Run `node design-preview/server.mjs` from the project root and open `http://127.0.0.1:4186/`. No build step. The running server reads assets with `no-store`; adding a new route requires a server restart.

## 10. Validation and next implementation boundary

Source values and current runtime were checked during capture. Prior session checks include page switching, filters, image loading and 9:16 dimensions, Day/Dark persistence, mobile header bounds, and JavaScript syntax. They are local prototype evidence, not physical-device, full accessibility or production acceptance.

Preservation checklist for future changes:

- Day remains visually stable; Dark keeps the latest dimmed surfaces.
- All three pages, dialogs, forms, chart labels and mobile navigation remain legible in both themes.
- Main titles remain period-free; logo spelling, image roles and source order stay consistent.
- At 375px phone, ~833px tablet and wide desktop, no clipped controls or page overflow; test 280px if retaining the current narrow support target.
- Check zero-data filters, reduced motion, theme persistence and manual mute.
- Before shipping: validate contrast comprehensively, physical iOS behavior, real data contracts and account boundaries, audio behavior/rights, asset delivery and production infrastructure.

No repository is currently initialized at this workspace root; commit, branch, deployed SHA and push status are unavailable. This capture does not initialize Git or authorize deployment. Git setup and production work remain separate owner-directed tasks.

## Shared typography implementation — 2026-09-09

Source of truth: `src/shared/theme/typography.css`, loaded once in `app/layout.tsx` before theme colors. It owns families (Inter for brand/navigation; DM Sans + Noto Sans Thai for body), size scale, responsive display/metric presets, weights and line heights. Theme colors remain in `tokens.css`; Day/Dark use the same readable type scale.

| Role | Shared preset | Size / line height |
| --- | --- | --- |
| Main text / clip title | `body` / `--text-body-size` | 16px / 1.6 |
| Supporting text / chart labels | `caption` / `--text-caption-size` | 14px minimum / 1.6 |
| Labels | `label` | 14px / 1.5 |
| Card heading | `cardTitle` | 20px / 1.4 |
| Section heading | `sectionTitle` | 22px / 1.4 |

Use `src/shared/ui/Text.tsx` for text blocks. Select semantic HTML independently from visual size, e.g. `<Text as="h2" variant="cardTitle">…</Text>` or `<Text variant="caption" tone="muted">…</Text>`. `Card` and `DataState` already use it; shell, content metadata and the foundation gallery consume the same component. Text defaults to a body paragraph and zero margins; the owning layout controls spacing.

Controls, numeric figures and SVG labels use the same CSS tokens directly where a text wrapper is inappropriate. Existing larger display sizes remain in the central scale to preserve the approved visual hierarchy; new code should prefer semantic presets. Feature CSS must not introduce literal font sizes, font-family stacks or smaller mobile overrides. Reflow/wrap or reduce chart tick density when space is tight. SVG viewBox width must match the rendered plot so a 14px label does not shrink through scaling. No blanket `!important` minimum or browser zoom workaround.

`/foundation` includes live Thai/English typography samples. `tests/unit/typography.test.tsx` checks semantic labels/headings and rejects page-local font literals; browser verification checks the actual computed sizes and overflow, which static tests cannot prove. Later F06/F07 pages inherit these presets and must use the same components.
