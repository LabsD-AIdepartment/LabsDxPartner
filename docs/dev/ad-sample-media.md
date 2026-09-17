# Archived reference — 2026-09-18

The sample media described below was removed from `public/media/ad-samples/` and
archived under `.agent-work/20260918-real-main/backup/ad-samples/`. It is not served
by the real application. The following records describe historical preview evidence.

# Partner-demo ad sample media — provenance

Dev-only sample assets bound into the **partner-demo** preview composition so the content list,
the enlarged media player and the Overview top content show genuine creative instead of a
fabricated placeholder. Everything here is preview-only; it never affects production data, earnings
or native ownership.

## What was bound

| Clip | Kind | Facebook ad | Creative | Asset | Local file |
|---|---|---|---|---|---|
| `clip-3` (Tendrix, confirmed) | video | `52513673563767` | `1004085732033027` | video `2629443027486387` | `public/media/ad-samples/tendrix-video.mp4` (+ poster) |
| `clip-sep-2` (Tendrix, September) | image | `52554922813367` | `1054509270657222` | — | `public/media/ad-samples/tendrix-graphic.jpg` |

Captions match the real ad names:
- Video: `พี่กอล์ฟ_ไม่เห็นผล ยินดีคืนเงิน`
- Graphic: `TD00116 P9.9 ลดแรง`

The binding lives in `dev/ad-sample-media.ts` (`AD_SAMPLES` + `applyAdSample`) and is applied ONLY in
`partner-demo` from both `dev/content-transport.ts` (list/detail) and `dev/overview-transport.ts`
(top content), through the same helper, so titles/covers cannot drift between surfaces.

## Source of truth (owner-authorized, read-only)

Identities and media were matched by a read-only Graph inspection and exact `asset_feed_spec` video
identity matching against owned ad videos. Evidence:
`.agent-work/20260916-content-media/evidence/matched-media.json`.

Reported Graph window `2026-08-17..2026-09-15` (for reference only, NOT shown as commission):
- Video ad `52513673563767`: ROAS `3.760042`, spend `18260.17`, video length `19.9s`.
- Graphic ad `52554922813367`: ROAS `3.961287`.

## Files and integrity

| File | Bytes | Type | SHA-256 |
|---|---|---|---|
| `tendrix-video.mp4` | 2534336 | ISO Media MP4, 19.9s | `6e993e11a09ccdc8ba1220848c19d00a357b9c05d18f828eb3a99117bf4e37eb` |
| `tendrix-video-poster.jpg` | 49293 | JPEG 1080x1080 | `743a8f4c58e5c1260f74cc850b6c468e630c58c2f35a732571d9dd95b5f4f859` |
| `tendrix-graphic.jpg` | 832362 | JPEG 2048x2048 | `ac074a096b9afa704ffd806e76f37941e45a3a0db7d74ff6584aca9495d37537` |

Each file is a byte-identical copy of its authorized raw source. Only same-origin `/media/...` paths
are stored — no CDN URL, signed link, token or query credential is ever placed in a client payload.

## Boundaries (do not cross)

- The financial rows these clips carry are **synthetic fixture commission**. The Graph ROAS/spend
  above is context only and must never be shown as partner commission or live native ownership.
- Every other clip keeps its `adReferences` **omitted (unknown)** — no fabricated ad ids.
- The synthetic in-fixture ads use internal route ids (e.g. `clip-3-ad-1`); those are never used as
  platform ids, and the real platform ids above are never used as internal route ids.
- These assets are removable independently: delete `public/media/ad-samples/` and the `AD_SAMPLES`
  entries, and the cards fall back to their prior covers with `adReferences` omitted.

Root verification: the poster was upgraded to the same creative's authorized 1080x1080 thumbnail. Browser decoded the video at 720x1280 with duration 20.009375s (provider metadata reports 19.9s); playback progressed and ended normally. Evidence: `.agent-work/20260916-content-media/evidence/video-playback.json`, `video-replay.json`.
