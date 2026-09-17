# Shared typography and readability correction

2026-09-09 · Local frontend candidate following F05. Owner requested readable Thai text on every page, then explicitly requested shared components/presets instead of page-specific hardcoding.

## Result and ownership

- `src/shared/theme/typography.css` owns font families, size scale, semantic roles, responsive display/metric presets, weights and line heights. Imported once by the root layout; all implemented application and dev-gallery CSS consumes it. Existing Day/Dark color tokens remain separate.
- `src/shared/ui/Text.tsx` exposes body, caption, label, cardTitle and sectionTitle presets; `as` preserves the appropriate HTML semantics and label associations. Card, DataState, Dialog/Sheet, shell, login/access and content metadata consume it. CSS variables remain the shared interface for inputs, chart labels and numeric figures.
- Restored the documented body/clip-title 16px and supporting/chart-label 14px minimum. Removed 11–13px overrides, including mobile navigation, cover badges, freshness, unavailable-order notes and preview controls. Global small elements follow the same floor. Existing larger display sizes are centralized without redesigning approved layout/images.
- TrendChart uses its actual observed width rather than a 240px minimum viewBox, preventing labels from shrinking in a narrower container. Sparse ticks remain; no financial calculation changed.
- `/foundation` shows Thai/English role samples. The design-system document records setup, consumption and future-page rules. Page CSS owns layout/spacing, not independent font definitions.

## Verification

Project-local evidence: `.agent-work/20260909-font-floor/evidence/`.

- `tests-final.log`: 93/93 tests in 12 files pass, including shared semantic heading/label behavior and a cross-folder guard against literal page font sizes/family stacks. Existing money, access, query and content tests remain green.
- `typecheck-final.log`: passed. `build-final.log`: production build and development-fixture exclusion passed.
- `browser-font-audit.json`: actual computed text sizes and document/element overflow checks across implemented page families: Overview, content library, expanded clip details, ad detail, Login/help, all nine access reasons plus active shell, foundation/gallery. Day and Dark; widths include 280, 375, 540, 800, 1440 and native1162 CSS px. The 28 post-floor observations have minimum14px and no horizontal overflow. The same file retains the initial `clip-desktop` baseline with a 13px development toolbar before its refreshed CSS; it is not a passing final observation.
- Library retains six covers and accessible search; removed explanatory rows remain absent. Shared dialog heading22px/body16px verified. Existing source fields and amounts remain unchanged.
- Native200% browser zoom, independent implementation review and owner acceptance remain open; viewport checks do not substitute for native zoom. No real identity/API/DB integration or release occurred. F06 is still next and has not started.

Rollback: revert this local typography commit. No schema/data rollback or deployment action required.

## Owner size increase — 2026-09-09

Owner requested another 2px increase to the smallest font. The shared caption/label/chart floor is now **16px**, superseding the earlier14px requirement above. Body remains16px and larger headings/figures remain unchanged. The lone15px narrow-login override now uses the16px body preset; its obsolete scale entry was removed. Gallery labels, canonical design guidance and the existing typography guard were updated together.

Validation:3/3 focused typography/chart tests pass, diff check clean; browser computed text minimum16px with no horizontal overflow on clip detail at1162/280 and Overview at280/800. Evidence `.agent-work/20260909-font-plus-two/evidence/`. No additional build for this token-only follow-up; prior build belongs to the preceding candidate.

## Shared text rhythm — 2026-09-17 (D189)

The current system separates **text rhythm** from **page layout**. Ordinary body and supporting text remain 16px. The historical universal minimum above has specific, subsequently owner-approved density exceptions listed below; those exceptions do not apply to ordinary paragraphs.

### Presets and component contract

| Role            | Leading                      | Intended use                                       |
| --------------- | ---------------------------- | -------------------------------------------------- |
| Body            | 1.45                         | Ordinary prose and inherited page text             |
| Compact         | 1.35                         | Captions, labels, metadata and short related text  |
| Heading         | 1.3                          | Card and section headings                          |
| Reading         | 1.6                          | Longer explanatory paragraphs; explicitly opt in   |
| Display / tight | 1.2 / 1.1                    | Existing money/display and brand roles, unchanged  |
| Control / input | 1.4 / 1.6                    | Shared buttons / form inputs; independent of prose |
| Calendar        | 1.6 base, 1.5 date summaries | Preserves D188 compact calendar geometry           |

`Text` retains its existing `as`, `variant`, `tone` and native HTML props. Optional `leading="body|compact|heading|reading"` changes only line height, independently of HTML semantics and font size. Default body uses Body; caption/label use Compact; cardTitle/sectionTitle use Heading. Use `as` for semantic headings and labels rather than selecting a visual role to imply meaning.

`TextGroup` groups related text without introducing ARIA roles:

```tsx
<TextGroup spacing="tight">
  <Text as="h2" variant="cardTitle">คอมมิชชัน</Text>
  <Text variant="caption" tone="muted">ยอดที่ยืนยันแล้ว</Text>
</TextGroup>
<TextGroup layout="inline" spacing="tight">
  <Text as="span" leading="compact">สวัสดี คุณพาร์ทเนอร์</Text>
  <Text as="span" variant="caption">Your content · Your impact</Text>
</TextGroup>
```

Default stack spacing is `related` (4px); `tight` is 2px. Inline groups wrap with the selected row gap and an 8px column gap. Direct child block margins are normalized **only inside the explicit group**. The default element is `div`; use `as="span"` inside phrasing-only containers such as a label, and keep its children phrasing content. Native props, IDs and accessibility attributes pass through. Do not put controls, full cards or unrelated sections in a TextGroup, or add a feature-specific gap competing with its preset.

### Adoption and intentional separation

| Surface                               | Text rhythm owner                                                               | Layout deliberately retained                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Shared Card                           | Title + description TextGroup                                                   | Card padding, heading/action separation                                                     |
| Shared Field / PasswordField          | Tight error + hint groups; strength copy uses related token                     | Label/input gap, button hit areas, strength meter, form/action spacing                      |
| Overview, including unavailable state | Tight inline greeting; tight identity; related weekly heading; text-pair tokens | Earnings pane's 14px section gap, cards/grid, calendar/navigation, chart and money geometry |
| Content cards                         | ContentCardInfo TextGroup; ad-reference rows use related token                  | 10px info-to-earned gap, charcoal earned panel, image/actions, metric/table layout          |
| Transactions                          | Related statement metadata and amount groups                                    | Statement rows, toolbar and card separation                                                 |
| Withdrawals and staff queue           | Related identity/notice groups; definition-list label/value tight token         | Financial rows, timeline sections, account eye slot, review/action/section spacing          |
| Login / access                        | Related form title+description and promise text; reading help paragraph         | Welcome icon, 20px heading offset, 28px form separation, hero and form sections             |
| Account                               | Related name/username and agreement text groups                                 | Agreement disclosure, security/credential components and actions                            |
| Shop Video                            | Related report metadata and registration proof text                             | Metrics, report disclosures, registration controls, permissions and query behavior          |
| Profile menu                          | Inherits shared Text/control leading                                            | Its 8px gaps separate actionable menu items, so they are not text-group gaps                |
| Foundation gallery                    | Thai/English heading+caption, body/reading and inline wrapping examples         | Existing gallery sections and controls                                                      |

Other feature CSS continues to own grids, card/row padding, section margins and control gaps. Reuse `--text-gap-tight`, `--text-gap-related` and `--text-gap-inline` for text-only structures where extra wrappers would damage semantics (for example `dt`/`dd`). Do not globally reset paragraph margins or turn every existing gap into text rhythm. Theme tokens own colors; this change does not alter financial facts, dates, query state or permissions.

### Existing density and responsive exceptions

All CSS font expressions now live in `typography.css`, including the exact previously accepted expressions: compact calendar 12.8px (`16 × .8`), narrow daily table 14px (`16 × .875`), notification count 12px, responsive tablet/mobile brand and page titles, and narrow withdrawal-detail heading. Fixed tablet brand/title values reuse the existing 24/32px scale tokens. These moves preserve font geometry; the typography guard remains unchanged. Compact SVG chart labels retain their measured chart-specific geometry rather than becoming body text. Calendar base/control leading is explicit so changing ordinary prose cannot enlarge or shrink its approved compact dialog.

Validation for this candidate is recorded in `.agent-work/20260917-text-rhythm/`; earlier receipts above are historical, not evidence for the current revision. Author checks and independent/root rendered acceptance are separate steps.
