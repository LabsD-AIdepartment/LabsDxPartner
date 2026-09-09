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
