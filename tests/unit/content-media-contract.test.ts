import { describe, expect, it } from 'vitest';
import {
  AdReference,
  ContentMedia,
  ContentCard,
  type AdReferenceValue,
} from '@/contracts/content';
import { contentCard, dataSql } from '@/server/modules/content/read-model';

/**
 * Pure contract + projection tests. No SQL runs here: the ad-linkage authority lives in the
 * read-model SQL (active target + partner/clip scope + matching connection + current sync mapping);
 * these tests only cover the wire contract and the JS card mapper's unknown/none/removed seams.
 */

const baseCardRow = {
  id: 'clip-1',
  title: 'A clip',
  brand: 'Axtion',
  published_at: '2026-09-01T00:00:00Z',
  cover: '/media/clip/cover.png',
  cover_position: '50% 50%',
  removed: false,
  amount: '1500',
  sales: '9000',
  earning_count: 3,
  agreement: 'v1',
};

describe('AdReference contract', () => {
  it('accepts every supported platform with an opaque bounded id', () => {
    for (const platform of ['facebook', 'tiktok', 'shopee', 'lazada'] as const)
      expect(AdReference.safeParse({ platform, externalId: 'abc_123-XYZ' }).success).toBe(true);
  });

  it('keeps large numeric ids as exact strings and never coerces a number', () => {
    const big = '123456789012345678901234567890'; // far beyond Number.MAX_SAFE_INTEGER
    const parsed = AdReference.parse({ platform: 'facebook', externalId: big });
    expect(parsed.externalId).toBe(big);
    expect(AdReference.safeParse({ platform: 'facebook', externalId: 1234567890 }).success).toBe(
      false,
    );
  });

  it('rejects hostile ids: empty, whitespace, control chars, over-length, unknown platform', () => {
    expect(AdReference.safeParse({ platform: 'facebook', externalId: '' }).success).toBe(false);
    expect(AdReference.safeParse({ platform: 'facebook', externalId: 'a b' }).success).toBe(false);
    expect(AdReference.safeParse({ platform: 'facebook', externalId: 'a	b' }).success).toBe(
      false,
    );
    expect(
      AdReference.safeParse({ platform: 'facebook', externalId: 'a'.repeat(161) }).success,
    ).toBe(false);
    expect(AdReference.safeParse({ platform: 'youtube', externalId: 'x' }).success).toBe(false);
    expect(
      AdReference.safeParse({ platform: 'facebook', externalId: 'x', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('ContentMedia contract', () => {
  it('accepts same-origin videos with allowed extensions and an optional local poster', () => {
    expect(ContentMedia.safeParse({ kind: 'video', src: '/media/clip/a.mp4' }).success).toBe(true);
    expect(ContentMedia.safeParse({ kind: 'video', src: '/media/a/b/c.webm' }).success).toBe(true);
    expect(
      ContentMedia.safeParse({
        kind: 'video',
        src: '/media/a.mp4',
        poster: '/media/a.jpg',
      }).success,
    ).toBe(true);
  });

  it('accepts a local cover image for the image variant', () => {
    expect(ContentMedia.safeParse({ kind: 'image', src: '/media/a/cover.webp' }).success).toBe(
      true,
    );
  });

  it('rejects remote urls, query, fragment, traversal, encoded traversal and wrong extensions', () => {
    const hostileVideo = [
      'https://cdn.example.com/a.mp4',
      '//cdn.example.com/a.mp4',
      '/media/a.mp4?token=1',
      '/media/a.mp4#t=10',
      '/media/../secret.mp4',
      '/media/%2e%2e/secret.mp4',
      '/media/a.mov',
      '/media/a.gif',
      '/uploads/a.mp4',
      '/media/a.mp4 ',
    ];
    for (const src of hostileVideo)
      expect(ContentMedia.safeParse({ kind: 'video', src }).success).toBe(false);
    // A video path is not a valid image path and vice versa.
    expect(ContentMedia.safeParse({ kind: 'image', src: '/media/a.mp4' }).success).toBe(false);
    expect(
      ContentMedia.safeParse({ kind: 'video', src: '/media/a.mp4', poster: '/media/p.mp4' })
        .success,
    ).toBe(false);
    // Unknown discriminant is rejected outright.
    expect(ContentMedia.safeParse({ kind: 'iframe', src: '/media/a.mp4' }).success).toBe(false);
  });

  it('enforces the path length bound', () => {
    const tooLong = '/media/' + 'a'.repeat(250) + '.mp4';
    expect(ContentMedia.safeParse({ kind: 'video', src: tooLong }).success).toBe(false);
  });
});

describe('ContentCard backward compatibility', () => {
  const base = {
    id: 'clip-1',
    title: 'A clip',
    brand: 'Axtion',
    publishedAt: '2026-09-01T00:00:00Z',
    cover: '/media/clip/cover.png',
    coverPosition: '50% 50%',
    removed: false,
    views: null,
    earned: { currency: 'THB', minor: '1500' },
    unavailableReason: null,
  };

  it('accepts an old payload that omits adReferences and media', () => {
    expect(ContentCard.safeParse(base).success).toBe(true);
  });

  it('accepts verified-none, populated and unknown ad linkage', () => {
    expect(ContentCard.safeParse({ ...base, adReferences: [] }).success).toBe(true);
    expect(ContentCard.safeParse({ ...base, adReferences: null }).success).toBe(true);
    expect(
      ContentCard.safeParse({
        ...base,
        adReferences: [{ platform: 'facebook', externalId: '120210000000000001' }],
      }).success,
    ).toBe(true);
  });

  it('rejects more than 100 ad references', () => {
    const many: AdReferenceValue[] = Array.from({ length: 101 }, (_, i) => ({
      platform: 'facebook' as const,
      externalId: `ad-${i}`,
    }));
    expect(ContentCard.safeParse({ ...base, adReferences: many }).success).toBe(false);
  });

  it('accepts optional/null media but rejects a fabricated remote video', () => {
    expect(ContentCard.safeParse({ ...base, media: null }).success).toBe(true);
    expect(
      ContentCard.safeParse({ ...base, media: { kind: 'video', src: '/media/a.mp4' } }).success,
    ).toBe(true);
    expect(
      ContentCard.safeParse({
        ...base,
        media: { kind: 'video', src: 'https://cdn.example.com/a.mp4' },
      }).success,
    ).toBe(false);
  });
});

describe('contentCard projection seams', () => {
  it('omits adReferences when linkage is unknown (marketing off or legacy row)', () => {
    expect('adReferences' in contentCard({ ...baseCardRow, ad_references: null }, true, 'r')).toBe(
      false,
    );
    expect('adReferences' in contentCard(baseCardRow, true, 'r')).toBe(false);
  });

  it('includes an empty array as verified-none and passes real references through', () => {
    expect(contentCard({ ...baseCardRow, ad_references: [] }, true, 'r').adReferences).toEqual([]);
    const refs: AdReferenceValue[] = [{ platform: 'facebook', externalId: '120210000000000001' }];
    expect(contentCard({ ...baseCardRow, ad_references: refs }, true, 'r').adReferences).toEqual(
      refs,
    );
  });

  it('never fabricates a media field in the native projection', () => {
    expect('media' in contentCard({ ...baseCardRow, ad_references: [] }, true, 'r')).toBe(false);
  });

  it('carries removed state and gates earnings behind the known flag', () => {
    const removed = contentCard({ ...baseCardRow, removed: true }, false, 'no access');
    expect(removed.removed).toBe(true);
    expect(removed.earned).toBeNull();
    expect(removed.unavailableReason).toBe('no access');
    const known = contentCard(baseCardRow, true, 'unused');
    expect(known.earned).toEqual({ currency: 'THB', minor: '1500' });
    expect(known.unavailableReason).toBeNull();
  });

  it('produces a card that satisfies the wire contract with references attached', () => {
    const card = contentCard(
      { ...baseCardRow, ad_references: [{ platform: 'tiktok', externalId: 'v-99' }] },
      true,
      'r',
    );
    expect(ContentCard.safeParse(card).success).toBe(true);
  });
});

/**
 * Regression guards on the composed ad-linkage query text. These assert the SQL carries the
 * suppression, canonical-identity validation and deterministic bound the root review required.
 * They do NOT execute Postgres and do not prove runtime behavior; the integration test
 * (tests/integration/native-content.test.ts) covers execution against a real database.
 */
describe('adReferences SQL guards (regression, query text only)', () => {
  const list = dataSql('list');
  const detail = dataSql('detail'); // the detail resource composes the metadata target projection

  it('gates linkage behind the marketing flag and suppresses removed clips per projection', () => {
    expect(list).toContain('$11::boolean and not b.removed');
    expect(detail).toContain('$11::boolean and not t.removed');
  });

  it('requires a canonical schemaVersion-2 object, never a coerced numeric externalId', () => {
    for (const sql of [list, detail]) {
      expect(sql).toContain("jsonb_typeof(a.source_identity)='object'");
      expect(sql).toContain("jsonb_typeof(a.source_identity->'schemaVersion')='number'");
      expect(sql).toContain("a.source_identity->>'schemaVersion'='2'");
      expect(sql).toContain("jsonb_typeof(a.source_identity->'externalId')='string'");
      // No throwing cast is ever applied to the untrusted json blob.
      expect(sql).not.toContain('source_identity::');
    }
  });

  it('matches every dimension to the association columns and the connection capability/platform', () => {
    for (const sql of [list, detail]) {
      expect(sql).toContain("a.source_identity->>'externalId'=a.external_id");
      expect(sql).toContain("a.source_identity->>'platform'=a.platform");
      expect(sql).toContain("a.source_identity->>'objectType'=a.object_type");
      expect(sql).toContain("a.source_identity->>'namespace'=a.namespace");
      expect(sql).toContain("a.source_identity->>'accountId'=a.account_id");
      expect(sql).toContain("a.source_identity->>'connectionId'=a.connection_id");
      expect(sql).toContain("a.source_identity->>'platform'=mc.platform");
      expect(sql).toContain("a.source_identity->>'capability'=mc.capability");
    }
  });

  it('orders deterministically before the 100-row bound so the projected set is stable', () => {
    for (const sql of [list, detail]) expect(sql).toContain('group by 1,2 order by 1,2 limit 100');
  });

  it('joins the active owned target, matching connection and current sync mapping', () => {
    for (const sql of [list, detail]) {
      expect(sql).toContain('join portal_marketing.targets mt on mt.id=a.target_id and mt.active');
      expect(sql).toContain('mc.namespace=a.namespace and mc.account_id=a.account_id');
      expect(sql).toContain('j.mapping_revision=a.mapping_revision');
    }
  });
});
