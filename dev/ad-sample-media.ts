import type { AdReferenceValue, ContentMediaValue } from '@/contracts/content';

// ---------------------------------------------------------------------------------------------
// DEV-ONLY sample binding for the "partner-demo" preview.
//
// These are REAL Facebook ad identities and REAL creative media, copied locally (byte-identical)
// from an owner-authorized, read-only Graph inspection into public/media/ad-samples/. They exist so
// the partner-demo composition can show a genuine enlarged video player and a genuine graphic cover
// instead of a fabricated placeholder. Provenance and the exact Graph evidence are recorded in
// docs/dev/ad-sample-media.md and .agent-work/20260916-content-media/evidence/matched-media.json.
//
// IMPORTANT — the financial rows these clips carry stay SYNTHETIC fixture commission. The live ROAS
// and spend of these ads (video ROAS 3.760042 / graphic ROAS 3.961287, 2026-08-17..2026-09-15) are
// NOT reflected in the demo earnings and must NEVER be presented as partner commission or as live
// native ownership. This overlay only replaces presentation (title / cover / player media) and adds
// the verified platform ad references; it never touches earnings, clip ids, dates or attribution.
//
// No CDN URLs, tokens or expiring signed links are stored: only same-origin /media paths.
// ---------------------------------------------------------------------------------------------

export type AdSample = {
  title: string;
  cover: string;
  media: ContentMediaValue;
  adReferences: AdReferenceValue[];
};

// Keyed by clip id in the partner-demo composition. Both are Tendrix clips (clip-3 = the confirmed
// Jul–Aug video clip that also surfaces in Overview top content; clip-sep-2 = the September graphic
// clip). Every other clip is intentionally absent -> its adReferences stay unknown (omitted).
export const AD_SAMPLES: Record<string, AdSample> = {
  // Facebook video ad 52513673563767 (creative 1004085732033027, asset video 2629443027486387).
  'clip-3': {
    title: 'พี่กอล์ฟ_ไม่เห็นผล ยินดีคืนเงิน',
    cover: '/media/ad-samples/tendrix-video-poster.jpg',
    media: {
      kind: 'video',
      src: '/media/ad-samples/tendrix-video.mp4',
      poster: '/media/ad-samples/tendrix-video-poster.jpg',
    },
    adReferences: [{ platform: 'facebook', externalId: '52513673563767' }],
  },
  // Facebook graphic ad 52554922813367 (creative 1054509270657222).
  'clip-sep-2': {
    title: 'TD00116 P9.9 ลดแรง',
    cover: '/media/ad-samples/tendrix-graphic.jpg',
    media: { kind: 'image', src: '/media/ad-samples/tendrix-graphic.jpg' },
    adReferences: [{ platform: 'facebook', externalId: '52554922813367' }],
  },
};

/**
 * Overlay a partner-demo sample onto a content card by clip id. Only presentation and the verified
 * ad references are replaced; the caller's financial fields (earned, unavailableReason, ...) are
 * preserved because this returns a shallow copy that keeps every other property. The owner-selected
 * clip-1 cover uses an unused supplied image without adding media or ad references. Other clips with
 * no sample are returned unchanged, so their adReferences stay unknown, never a fake id.
 */
export function applyAdSample<T extends { id: string; title: string; cover: string | null }>(
  card: T,
): T {
  const sample = AD_SAMPLES[card.id];
  if (!sample) return card.id === 'clip-1' ? { ...card, cover: '/media/clip-cover-3.png' } : card;
  return {
    ...card,
    title: sample.title,
    cover: sample.cover,
    media: sample.media,
    adReferences: sample.adReferences,
  };
}
