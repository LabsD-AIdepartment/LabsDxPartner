import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentFixture } from '../../dev/content-transport';
import { overviewFixture } from '../../dev/overview-transport';
import { AD_SAMPLES } from '../../dev/ad-sample-media';
import type { ContentRequest } from '@/features/content/model';

/**
 * Dev-fixture binding regression. Verifies the partner-demo ad-sample overlay is consistent across
 * the content list, the content detail and the Overview top content; that the platform ad ids are
 * carried as exact strings; that the synthetic financial totals are untouched by the presentation
 * overlay; and that archived sample media cannot be served by the real app's public directory.
 * These exercise the dev transports directly, not the frozen UI.
 */

// A window that reaches the September open period so the graphic (clip-sep-2) is included.
const context = { from: '2026-07-01', toExclusive: '2026-10-01', brand: null, q: '', cursor: null };
type Loose = { data: { items: any[]; content?: any } };
function ask(resource: ContentRequest['resource'], extra: Record<string, unknown> = {}) {
  return contentFixture(
    { resource, context, ...extra } as unknown as Omit<ContentRequest, 'signal'>,
    'partner-demo',
  ) as unknown as Loose;
}

const VIDEO = {
  id: 'clip-3',
  title: 'พี่กอล์ฟ_ไม่เห็นผล ยินดีคืนเงิน',
  cover: '/media/ad-samples/tendrix-video-poster.jpg',
  externalId: '52513673563767',
};
const GRAPHIC = {
  id: 'clip-sep-2',
  title: 'TD00116 P9.9 ลดแรง',
  cover: '/media/ad-samples/tendrix-graphic.jpg',
  externalId: '52554922813367',
};

describe('partner-demo ad-sample binding — video clip (clip-3)', () => {
  it('binds the same title/cover/media/adReferences in list, detail and Overview top content', () => {
    const list = ask('list').data.items.find((c) => c.id === VIDEO.id);
    const detail = ask('detail', { contentId: VIDEO.id }).data.content;
    const top = overviewFixture(
      { from: context.from, toExclusive: context.toExclusive, brand: null },
      'partner-demo',
    ).earnings.topContent.find((c) => c.id === VIDEO.id);

    expect(top).toBeDefined(); // clip-3 is a confirmed top-3 clip, so drift here would be visible
    for (const card of [list, detail, top]) {
      expect(card.title).toBe(VIDEO.title);
      expect(card.cover).toBe(VIDEO.cover);
      expect(card.media).toEqual({
        kind: 'video',
        src: '/media/ad-samples/tendrix-video.mp4',
        poster: '/media/ad-samples/tendrix-video-poster.jpg',
      });
      expect(card.adReferences).toEqual([{ platform: 'facebook', externalId: VIDEO.externalId }]);
    }
  });

  it('carries the ad id as an exact string, stored verbatim and never as a number', () => {
    const ref = ask('list').data.items.find((c) => c.id === VIDEO.id).adReferences[0];
    expect(ref.externalId).toBe(VIDEO.externalId);
    expect(typeof ref.externalId).toBe('string');
    expect(ref.externalId).toBe(AD_SAMPLES[VIDEO.id].adReferences[0].externalId);
  });
});

describe('partner-demo ad-sample binding — graphic clip (clip-sep-2)', () => {
  it('binds the image sample in list and detail', () => {
    const list = ask('list').data.items.find((c) => c.id === GRAPHIC.id);
    const detail = ask('detail', { contentId: GRAPHIC.id }).data.content;
    for (const card of [list, detail]) {
      expect(card.title).toBe(GRAPHIC.title);
      expect(card.cover).toBe(GRAPHIC.cover);
      expect(card.media).toEqual({ kind: 'image', src: GRAPHIC.cover });
      expect(card.adReferences).toEqual([{ platform: 'facebook', externalId: GRAPHIC.externalId }]);
    }
  });
});

describe('partner-demo ad-sample binding — isolation', () => {
  it('leaves every other clip without adReferences or media (unknown, never a fake id)', () => {
    for (const card of ask('list').data.items)
      if (card.id !== VIDEO.id && card.id !== GRAPHIC.id) {
        expect('adReferences' in card).toBe(false);
        expect('media' in card).toBe(false);
      }
  });

  it('never applies the overlay outside partner-demo', () => {
    const ready = contentFixture(
      { resource: 'list', context } as unknown as Omit<ContentRequest, 'signal'>,
      'ready',
    ) as unknown as Loose;
    const clip3 = ready.data.items.find((c) => c.id === VIDEO.id);
    expect(clip3.title).not.toBe(VIDEO.title);
    expect('media' in clip3).toBe(false);
    expect('adReferences' in clip3).toBe(false);
  });

  it('never invents an internal-route ad id as a platform id', () => {
    // The synthetic ads list uses internal ids like "clip-3-ad-1"; none may leak into adReferences.
    const ads = ask('ads', { contentId: VIDEO.id }).data.items;
    expect(ads.some((a: { id: string }) => /-ad-\d+$/.test(a.id))).toBe(true);
    const refIds = AD_SAMPLES[VIDEO.id].adReferences.map((r) => r.externalId);
    expect(refIds.every((id) => !id.includes('-ad-'))).toBe(true);
  });
});

describe('partner-demo ad-sample binding — financial totals unchanged', () => {
  it('keeps the synthetic confirmed/estimated totals and clip earnings the presentation overlay must not touch', () => {
    const overview = overviewFixture(
      { from: context.from, toExclusive: context.toExclusive, brand: null },
      'partner-demo',
    );
    expect(overview.earnings.confirmed?.minor).toBe('3736000'); // sum of the 6 confirmed clips
    expect(overview.earnings.estimated?.minor).toBe('700000'); // the two September estimated lines
    const clip3 = ask('list').data.items.find((c) => c.id === VIDEO.id);
    expect(clip3.earned.minor).toBe('960000'); // unchanged by the overlay
    const sep2 = ask('list').data.items.find((c) => c.id === GRAPHIC.id);
    expect(sep2.earned.minor).toBe('0'); // estimated-only clip has no confirmed commission yet
  });
});

describe('ad-sample media files', () => {
  const dir = resolve(__dirname, '../../public/media/ad-samples');
  it('keeps archived sample assets out of the public application', () => {
    expect(existsSync(dir)).toBe(false);
  });

  it('are referenced only by same-origin /media paths with no token, query or remote host', () => {
    for (const sample of Object.values(AD_SAMPLES)) {
      const paths = [
        sample.cover,
        sample.media.src,
        ...('poster' in sample.media ? [sample.media.poster!] : []),
      ];
      for (const p of paths) {
        expect(p.startsWith('/media/ad-samples/')).toBe(true);
        expect(p).not.toMatch(/[?#]|:\/\//);
      }
    }
  });
});
