# Labs D document fonts

`document-fonts.ts` contains static, offline TrueType fonts for PDF rendering:

- `documentRegularBase64`: weight 400.
- `documentSemiBoldBase64`: weight 600.

Latin letters, punctuation and numbers use **DM Sans**. Thai uses **Noto Sans Thai**.
These are the same font families and pinned `@fontsource-variable/*` 5.3.0 assets
used by the web app. The merged family is named **Labs D Document** to identify
the derivative. It is not a separate visual typeface.

Both fonts retain Thai GSUB/GPOS/GDEF layout data and the dotted-circle base;
Thai marks are positioned by fontkit when embedded with pdf-lib. Input Unicode
ranges are disjoint, so numerals and Latin punctuation cannot accidentally use
the Thai fallback family. The source Latin subset covers the application's
Latin/Thai documents, not arbitrary world scripts.

## Provenance and license

Sources are pinned by package-lock.json and recorded with SHA-256 checksums in
`font-manifest.json`. The generator uses the already-installed Fontsource files;
it does not fetch a font at application runtime.

- DM Sans, Google Fonts v17. Copyright 2014 The DM Sans Project Authors.
  Upstream: https://github.com/googlefonts/dm-fonts
- Noto Sans Thai, Google Fonts v29. Copyright 2022 The Noto Project Authors.
  Upstream: https://github.com/notofonts/thai
- Distribution source: https://github.com/google/fonts

Both are SIL Open Font License 1.1. Full licenses and copyright notices are
bundled as `OFL-DM-Sans.txt` and `OFL-Noto-Sans-Thai.txt`.

## Regeneration

Run from the repository root after installing the locked Node dependencies.
This keeps Python dependencies, intermediate fonts and temporary files inside
the project's ignored work directory:

```sh
mkdir -p .agent-work/20260918-document-design/cache .agent-work/20260918-document-design/tmp
UV_CACHE_DIR="$PWD/.agent-work/20260918-document-design/cache" \
TMPDIR="$PWD/.agent-work/20260918-document-design/tmp" \
uv run --no-project --with 'fonttools[woff]==4.59.2' --python /opt/homebrew/bin/python3 \
  python src/shared/documents/assets/generate-document-fonts.py
```

The generator instantiates all variation axes (weight 400/600 and defaults for
other axes), subsets the two scripts with layout closure, merges them, renames
the derivative, and emits TypeScript base64 plus the source/output manifest.
The glyph timestamps are fixed for reproducible outputs. Fonts stay embedded
in the generated PDF; the recipient needs no installed fonts or network access.
