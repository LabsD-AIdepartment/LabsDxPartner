# Report font provenance

The overview PDF export embeds **Sarabun**, a static TrueType family that covers Thai
(including tone marks and the baht sign ฿ U+0E3F) together with full Latin letters, digits
and punctuation. One family therefore renders the mixed Thai/English report without any glyph
fallback, so no Chromium/print pipeline or system font is required.

| File | Weight | Bytes |
| --- | --- | --- |
| `Sarabun-Regular.ttf` | 400 | ~90 KB |
| `Sarabun-SemiBold.ttf` | 600 | ~90 KB |

- **Family:** Sarabun (The Sarabun Project Authors / Cadson Demak)
- **License:** SIL Open Font License, Version 1.1 — see `OFL.txt` in this folder.
- **Upstream:** https://github.com/google/fonts/tree/main/ofl/sarabun
- **Retrieved:** 2026-09-16 via
  `https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-{Regular,SemiBold}.ttf`
  and `.../OFL.txt`.

## Regenerating the embedded module

`report-fonts.ts` base64-embeds the two `.ttf` files above so the browser export chunk and the
node/jsdom test runner load identical bytes without a network fetch. The `.ttf` files remain the
licensed source of truth. To regenerate after replacing a font file, run from the repo root with
the pinned runtime:

```
/opt/homebrew/opt/node@24/bin/node src/features/overview/assets/generate-report-fonts.mjs
```
