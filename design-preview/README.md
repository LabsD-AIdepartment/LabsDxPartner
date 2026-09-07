> **Current Phase 1 baseline (2026-09-07):** Read [Theme Design System](../docs/design/phase-1-theme-design-system.md). The chronological notes below are retained as history and contain superseded details (image sources/ratios, logo weight, gradients and Dark mode). Current source and that specification take precedence.

# Labs D × Partner — visual design preview

A local, dependency-free appearance prototype for Celeb Collapse. The owner asked to see the existing dashboard in the supplied reference's light grey, rounded white card, charcoal and lime visual style.

Run from the project root:

```sh
node design-preview/server.mjs
```

Open http://127.0.0.1:4186/. No build or install is required.

## Scope

- Overview, content library and transaction design examples.
- Period/brand filters and a clip detail dialog, using six fixed example clips from the existing public draft.
- The displayed aggregate is the sum of those six examples, not the original dashboard's larger aggregate.
- Example payout statuses are invented for layout demonstration. No real authentication, backend, payout, live reporting or file export.
- The prototype uses Google Fonts and the owner-provided image in `assets/celebrity-thumbnail.png` as the large partner profile image. Clip thumbnails use the original website image. The image is copied unchanged; CSS controls thumbnail framing.
- Existing site: https://partnerdash-pzpgf5kz.manus.space/
- Visual reference: user-supplied e8b91255d75d88341bd2a42d5a0b39f8.jpg.

The supplied research documents are background information and do not authorize implementation of their system proposals. This preview does not change the hosted website.

## Preview checks

Checked the rendered desktop and mobile layouts: no horizontal page overflow. Confirmed brand filtering (Axtion commission = ฿15,920), two Axtion search results, and opening/closing the example commission dialog. Screenshots are under `.agent-work/20260907-dashboard-redesign/evidence/`. Local JavaScript syntax checks passed; this is a visual prototype, not production validation.

## Current visual direction

Restored the first light grey / lime / bento preview at the owner's request on 7 September 2026. Future changes should be incremental, one point at a time. The later Thai-first redesign was rejected and is preserved only in the ignored internal work area. The current preview retains the original layout and uses the owner-provided photograph in the large profile card, while clip thumbnails retain the original website image.

## Typography rebalance

Supporting text now has a 14px minimum across the preview, with 16px body/control text, 20px section headings and larger financial figures. Muted text is darker. Cards accommodate the larger type without clipping. Chart SVG labels render at the container's actual width; narrow charts omit some date ticks instead of shrinking the font. Brand bars reflow horizontally when their card becomes too narrow for readable labels.

Verified visible text sizes and no page overflow at measured CSS widths of 280, 416, 1327 and 1440 pixels; checked clip/payout views on mobile and the Axtion filter. Typography-only baseline is saved in the ignored versions folder for incremental adjustments.

## Green chart accents

The full green theme was rolled back at the owner's request. Base surfaces, cards, controls and the line chart retain their previous colors. The bar chart, donut chart and completed payout progress segments keep the fresh green gradients and dimensional shading in `green-theme.css`; donut legend colors match the ring. Typography and layout are unchanged. The complete green theme is preserved in the ignored versions folder.

## Shared page accents

The owner requested matching Overview greens on My content and Transactions. Content earnings panels use a pale green gradient with dark green figures; transaction summaries, table headings and paid badges carry the same palette. The Labs D wordmark is 20% larger (33.6px desktop / 31.2px mobile) and weight 700. Checked both pages at desktop and 416px CSS width without page overflow; mobile summaries stack vertically.

## Entrance motion

`motion.css` adds short, one-shot staggered card entrances, line drawing, bar growth, donut reveal and dialog transitions. Bar growth switches to the horizontal axis for the narrow card layout. The figures remain the actual sample values throughout; there is no numerical count-up or looping animation. Motion is enabled only under `prefers-reduced-motion: no-preference`, so reduced-motion users see the complete static interface immediately. Checked settled opacity, line stroke offset, page switching, filter totals and dialog behavior.

## Responsive layouts

`responsive.css` is the final layout layer. The shell uses viewport breakpoints; Overview, content and payments use their own available container widths. Tablet Overview places the profile photo next to the earnings summary, with a full-width line chart and paired sales/payout cards. Phones stack cards, simplify heading chrome and keep all three navigation destinations in a fixed bottom bar with safe-area padding. Controls have at least 44px touch height; supporting text stays at 14px or larger.

Content tiles choose their column count from available space. Narrow transaction tables reshape the same rows into labeled cards (two columns where space permits), preserving table accessibility roles and every displayed field. Dialogs fit the dynamic viewport; mobile help is available in the footer. Page changes return to the top, and the logo returns to Overview.

Verified all three pages at CSS widths 280, 375, 540, 800, 833, 1024, 1194 and 1440: no page overflow, card clipping or obstructed navigation. Final targeted checks confirmed the 14px text floor, Axtion search/filter totals (two clips, ฿15,920), clip dialog bounds, help open/close and page-switch scroll reset. This is browser viewport verification, not a test on physical iOS hardware. Evidence is in the ignored `responsive-*` files under the project work area.

The logo's latest approved size is 40.32px on desktop and 37.44px on mobile, with weight 700; the main heading uses weight 550.
