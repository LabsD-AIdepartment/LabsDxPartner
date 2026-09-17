import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createContentHttp } from '@/server/http/content';
import { createContentReader } from '@/server/modules/content/read-model';
import { ContentHttpResponse } from '@/contracts/content-http';
import { contentHttp } from '@/features/content/http';
import { loadContent } from '@/features/content/model';
import { initialReportContext } from '@/shared/routing/report-context';
type TestScope = Awaited<ReturnType<typeof setup>>;
async function content(s: TestScope, resource = 'list', extra: Record<string, string> = {}) {
  const params = { ...s.params, resource, ...extra };
  return createContentHttp(access)(
    new Request(config.BETTER_AUTH_URL + '/api/v1/partner/content?' + new URLSearchParams(params), {
      headers: s.viewer.headers,
    }),
  );
}
async function readContent(
  s: TestScope,
  resource: 'list' | 'detail' | 'earnings' | 'ads' = 'list',
  extra: Record<string, string> = {},
) {
  const response = await content(s, resource, extra);
  // In a synthetic test, surface the reader failure instead of masking it behind the safe HTTP error.
  if (response.status === 503)
    await createContentReader(access)(s.viewer.headers, { ...s.params, resource, ...extra });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return ContentHttpResponse.parse(await response.json());
}

describe('native published Content journey', () => {
  it('discovers catalogue clips outside publication dates without inventing earnings', async () => {
    const s = await setup();
    await s.catalogue();
    const window = { from: '2026-09-01', toExclusive: '2026-09-10' };
    for (const publish of [false, true]) {
      if (publish) await (await s.ingest()).publish();
      const library = await readContent(s, 'list', window);
      if (library.resource !== 'list') throw new Error('Expected list');
      expect(library.result.data.totalCount).toBe(6);
      expect(library.result.dataState).toBe('partial');
      expect(library.result.coverage?.status).toBe('unavailable');
      expect(library.result.data.items.every((clip) => clip.earned === null && clip.cover)).toBe(
        true,
      );
      expect(library.result.brands).toEqual(['Axtion', 'Melura', 'Rusiren', 'Tendrix', 'Zenova']);
      const filtered = await readContent(s, 'list', { ...window, brand: 'Axtion', q: 'routine' });
      if (filtered.resource !== 'list') throw new Error('Expected list');
      expect(filtered.result.data.items.map((clip) => clip.id)).toEqual(['clip-2']);
      const detail = await readContent(s, 'detail', {
        ...window,
        contentId: 'clip-1',
        generation: library.result.generation,
      });
      if (detail.resource !== 'detail') throw new Error('Expected detail');
      expect(detail.result.data.content.earned).toBeNull();
      expect(detail.result.data.eligibleSales).toBeNull();
    }
    const covered = await readContent(s, 'list', { from: '2026-07-01', toExclusive: '2026-08-01' });
    if (covered.resource !== 'list') throw new Error('Expected list');
    expect(covered.result.data.totalCount).toBe(6);
    expect(covered.result.data.items.every((clip) => clip.earned?.minor === '0')).toBe(true);
    await sql`update portal_access.memberships set capabilities=ARRAY['view_content'],permission_revision=2 where partner_id=${s.partnerId}`;
    const restricted = await readContent(s, 'list', { ...window, permissionRevision: 'p1:m2' });
    if (restricted.resource !== 'list') throw new Error('Expected list');
    expect(restricted.result.data.items).toHaveLength(6);
    expect(restricted.result.data.items.every((clip) => clip.earned === null)).toBe(true);
    expect((await content(s, 'list', { ...window, partnerId: randomUUID() })).status).toBe(403);
  });
  it('continues earning rows without duplicate or missing microsecond ties and reconciles multiple agreements', async () => {
    const s = await setup();
    await s.catalogue();
    const original = s.sample.file.rows[0];
    if (original.disposition !== 'included') throw new Error('Expected included row');
    for (let i = 0; i < 55; i++) {
      const line = {
        ...structuredClone(original),
        entitlement: { ...original.entitlement, reference: 'bonus-' + i },
        agreementVersion: 'synthetic-agreement-2',
        earnedAt: i === 0 ? '2026-08-30T05:00:00.000002Z' : '2026-08-30T05:00:00.000001Z',
        earning: { kind: 'bonus' as const, approvalRef: 'approved-bonus-' + i, amountMinor: '1' },
      };
      s.sample.file.rows.push(line);
      s.sample.context.amounts.push({
        entitlement: line.entitlement,
        agreementVersion: line.agreementVersion,
        earnedAt: line.earnedAt,
        evidenceRef: line.evidenceRef,
        earning: line.earning,
      });
      s.sample.context.attributions.push({
        ...s.sample.context.attributions[0],
        entitlement: line.entitlement,
      });
    }
    const controls = {
      rows: 61,
      included: 61,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '55000000',
      amountMinor: '3736055',
    };
    s.sample.file.sources[0].controls = controls;
    s.sample.context.sources[0].controls = controls;
    await (await s.ingest()).publish();
    const detail = await readContent(s, 'detail', { contentId: 'clip-1' });
    if (detail.resource !== 'detail') throw new Error('Expected detail');
    expect(detail.result.data.agreementVersion).toBeNull();
    expect(detail.result.data.content.earned?.minor).toBe('1280055');
    const first = await readContent(s, 'earnings', { contentId: 'clip-1' });
    if (first.resource !== 'earnings') throw new Error('Expected earnings');
    expect(first.result.data.items).toHaveLength(50);
    expect(first.result.data.items[0].earnedAt).toBe('2026-08-30T05:00:00.000002Z');
    const cursor = first.result.data.nextCursor!;
    const second = await readContent(s, 'earnings', {
      contentId: 'clip-1',
      cursor,
      generation: first.result.generation,
    });
    if (second.resource !== 'earnings') throw new Error('Expected earnings');
    const lines = [...first.result.data.items, ...second.result.data.items];
    expect(lines).toHaveLength(56);
    expect(new Set(lines.map((l) => l.id)).size).toBe(56);
    expect(lines.reduce((sum, l) => sum + BigInt(l.amount.minor), 0n)).toBe(1280055n);
    expect(second.result.data.nextCursor).toBeNull();
    expect((await content(s, 'earnings', { contentId: 'clip-2', cursor })).status).toBe(409);
  });
  it('retains an archived clip and its income, with its reviewed source URL', async () => {
    const s = await setup(),
      catalog = celebrityCatalogue(s.partnerId);
    catalog.clips[0].sourceUrl = 'https://www.facebook.com/reel/synthetic-test';
    await s.catalogue(catalog);
    await (await s.ingest()).publish();
    const before = await readContent(s, 'detail', { contentId: 'clip-1' });
    if (before.resource !== 'detail') throw new Error('Expected detail');
    expect(before.result.data.sourceUrl).toBe(catalog.clips[0].sourceUrl);
    catalog.clips.shift();
    await s.catalogue(catalog, '1');
    const after = await readContent(s, 'detail', { contentId: 'clip-1' });
    if (after.resource !== 'detail') throw new Error('Expected detail');
    expect(after.result.data.content.removed).toBe(true);
    expect(after.result.data.content.earned?.minor).toBe('1280000');
    expect(after.result.generation).not.toBe(before.result.generation);
  });
  it('reconciles Overview, continuous library, clip and earning rows on the same generation', async () => {
    const s = await setup();
    await s.catalogue();
    await (await s.ingest()).publish();
    const overview = await s.read();
    const library = await readContent(s, 'list', { generation: overview.data.earnings.generation });
    if (library.resource !== 'list') throw new Error('Expected list');
    expect(library.result.data.totalCount).toBe(6);
    expect(library.result.data.items.map((c) => c.id)).toEqual([
      'clip-1',
      'clip-2',
      'clip-3',
      'clip-4',
      'clip-5',
      'clip-6',
    ]);
    expect(library.result.data.items.reduce((sum, c) => sum + BigInt(c.earned!.minor), 0n)).toBe(
      3736000n,
    );
    expect(library.result.data.items.every((c) => c.views === null)).toBe(true);
    expect(library.result.brands).toEqual(['Axtion', 'Melura', 'Rusiren', 'Tendrix', 'Zenova']);
    const detail = await readContent(s, 'detail', {
      contentId: 'clip-3',
      generation: library.result.generation,
    });
    if (detail.resource !== 'detail') throw new Error('Expected detail');
    expect(detail.result.data.content.earned?.minor).toBe('960000');
    expect(detail.result.data.eligibleSales?.minor).toBe('9600000');
    expect(detail.result.data.eligibleOrders).toBeNull();
    expect(detail.result.data.adCount).toBeNull();
    expect(detail.result.data.metrics).toEqual([]);
    const lines = await readContent(s, 'earnings', {
      contentId: 'clip-3',
      generation: detail.result.generation,
    });
    if (lines.resource !== 'earnings') throw new Error('Expected earnings');
    expect(lines.result.data.items).toHaveLength(1);
    expect(lines.result.data.items[0]).toMatchObject({
      amount: { minor: '960000' },
      eligibleBase: { minor: '9600000' },
      ratePpm: 100000,
      status: 'confirmed',
      contentId: 'clip-3',
    });
    const ads = await readContent(s, 'ads', { contentId: 'clip-3' });
    expect(ads.result.dataState).toBe('unavailable');
    expect((await content(s, 'ad', { contentId: 'clip-3', adId: 'not-supplied' })).status).toBe(
      503,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        createContentHttp(access)(
          new Request(config.BETTER_AUTH_URL + url, { ...init, headers: s.viewer.headers }),
        ),
      ),
    );
    try {
      const result = await loadContent(contentHttp, {
        resource: 'detail',
        scope: { userId: s.viewer.id, partnerId: s.partnerId, permissionRevision: 'p1:m1' },
        context: { ...initialReportContext, generation: overview.data.earnings.generation },
        contentId: 'clip-3',
        signal: new AbortController().signal,
      });
      expect(result.data.content.earned?.minor).toBe('960000');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('shows reviewed covers before publication, then known zero and partial coverage honestly', async () => {
    const s = await setup();
    await s.catalogue();
    const draft = await s.ingest();
    const unknown = await readContent(s);
    if (unknown.resource !== 'list') throw new Error('Expected list');
    expect(unknown.result.data.items).toHaveLength(6);
    expect(
      unknown.result.data.items.every((c) => c.earned === null && c.cover?.startsWith('/media/')),
    ).toBe(true);
    expect(unknown.result.dataState).toBe('partial');
    await draft.publish();
    const zero = await readContent(s, 'detail', {
      contentId: 'clip-3',
      from: '2026-07-01',
      toExclusive: '2026-08-01',
    });
    if (zero.resource !== 'detail') throw new Error('Expected detail');
    expect(zero.result.data.content.earned?.minor).toBe('0');
    const partial = await readContent(s, 'detail', {
      contentId: 'clip-3',
      toExclusive: '2026-10-01',
    });
    expect(partial.result.dataState).toBe('partial');
    expect('coverage' in partial.result && partial.result.coverage?.status).toBe('partial');
  });
  it('keeps brand/search filters scoped and generations consistent with Overview', async () => {
    const s = await setup();
    await s.catalogue();
    await (await s.ingest()).publish();
    const overview = await s.read({ brand: 'Axtion' });
    const filtered = await readContent(s, 'list', {
      brand: 'Axtion',
      generation: overview.data.earnings.generation,
    });
    if (filtered.resource !== 'list') throw new Error('Expected list');
    expect(filtered.result.data.items).toHaveLength(2);
    expect(filtered.result.data.items.reduce((sum, c) => sum + BigInt(c.earned!.minor), 0n)).toBe(
      1592000n,
    );
    expect((await content(s, 'detail', { contentId: 'clip-3', brand: 'Axtion' })).status).toBe(404);
    const search = await readContent(s, 'list', { q: 'Tendrix' });
    if (search.resource !== 'list') throw new Error('Expected list');
    expect(search.result.data.items.map((c) => c.id)).toEqual(['clip-3']);
    expect(search.result.generation).toBe((await s.read()).data.earnings.generation);
    const literal = await readContent(s, 'list', { q: '%' });
    if (literal.resource !== 'list') throw new Error('Expected list');
    expect(literal.result.data.items).toHaveLength(0);
  });
  it('paginates catalogue by microsecond time and ID and refuses a stale or retargeted cursor', async () => {
    const s = await setup(),
      catalog = celebrityCatalogue(s.partnerId);
    const original = catalog.clips[0];
    catalog.clips = Array.from({ length: 57 }, (_, i) => ({
      ...original,
      id: 'batch-' + String(i).padStart(3, '0'),
      publishedAt: i === 0 ? '2026-08-28T00:00:00.000002Z' : '2026-08-28T00:00:00.000001Z',
    }));
    await s.catalogue(catalog);
    await (await s.ingest()).publish();
    const first = await readContent(s);
    if (first.resource !== 'list') throw new Error('Expected list');
    expect(first.result.data.items).toHaveLength(50);
    expect(first.result.data.items[0].id).toBe('batch-000');
    const cursor = first.result.data.nextCursor!;
    expect(cursor.length).toBeLessThan(1000);
    const second = await readContent(s, 'list', { cursor, generation: first.result.generation });
    if (second.resource !== 'list') throw new Error('Expected list');
    expect(second.result.data.items).toHaveLength(7);
    expect(
      new Set([...first.result.data.items, ...second.result.data.items].map((c) => c.id)).size,
    ).toBe(57);
    expect(second.result.data.nextCursor).toBeNull();
    expect((await content(s, 'list', { cursor, q: 'different' })).status).toBe(409);
    expect((await content(s, 'list', { cursor: 'invalid' })).status).toBe(400);
    await s.catalogue(catalog, '1');
    expect((await content(s, 'list', { cursor })).status).toBe(409);
    expect(
      (await content(s, 'detail', { contentId: 'batch-000', generation: first.result.generation }))
        .status,
    ).toBe(409);
  });
  it('requires current Content and separate earnings access, and never exposes a foreign clip', async () => {
    const s = await setup();
    await s.catalogue();
    await (await s.ingest()).publish();
    expect((await content(s, 'detail', { contentId: 'unknown' })).status).toBe(404);
    expect((await content(s, 'list', { partnerId: randomUUID() })).status).toBe(403);
    expect((await content(s, 'list', { permissionRevision: 'old' })).status).toBe(403);
    expect((await content(s, 'list', { userId: s.viewer.id })).status).toBe(400);
    await sql`update portal_access.memberships set capabilities=ARRAY['view_content'],permission_revision=2 where partner_id=${s.partnerId}`;
    const noMoney = await readContent(s, 'detail', {
      contentId: 'clip-3',
      permissionRevision: 'p1:m2',
    });
    if (noMoney.resource !== 'detail') throw new Error('Expected detail');
    expect(noMoney.result.data.content.earned).toBeNull();
    expect(noMoney.result.data.eligibleSales).toBeNull();
    expect(noMoney.result.data.agreementVersion).toBeNull();
    expect(
      (await content(s, 'earnings', { contentId: 'clip-3', permissionRevision: 'p1:m2' })).status,
    ).toBe(403);
    await sql`update portal_access.memberships set status='suspended' where partner_id=${s.partnerId}`;
    expect((await content(s, 'list', { permissionRevision: 'p1:m2' })).status).toBe(403);
  });
});
