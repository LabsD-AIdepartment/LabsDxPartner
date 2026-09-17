import { describe, expect, it } from 'vitest';
import { setup, sql } from '../helpers/partner-finance';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
import { OverviewResponse } from '@/contracts/overview-http';

describe('published finance load acceptance', () => {
  it('reconciles 100000 rows for 100 partners and isolates 20 concurrent Overview reads', async () => {
    const partners: Awaited<ReturnType<typeof setup>>[] = [];
    const generations: string[] = [];
    const began = performance.now();
    for (let index = 0; index < 100; index++) {
      const f = await setup({ sessionFixture: 'persisted' });
      const catalogue = celebrityCatalogue(f.partnerId);
      catalogue.clips.forEach((clip) => {
        clip.publishedAt = '2026-06-01T00:00:00Z';
      });
      await f.catalogue(catalogue);
      const original = f.sample.file.rows[0];
      if (original.disposition !== 'included' || original.earning.kind !== 'commission')
        throw new Error('Expected commission template');
      const commission = original.earning;
      // Independent closed-form controls: 10% of (100005 + 100*i) minor units
      // rounds from (10000.5 + 10*i) to (10001 + 10*i) PER LINE.
      // Summing then rounding would understate each partner's 1000 lines by 500 minor units.
      const base = BigInt(100005 + 100 * index);
      const amount = BigInt(10001 + 10 * index);
      f.sample.file.rows = Array.from({ length: 1000 }, (_, row) => ({
        ...original,
        entitlement: { ...original.entitlement, reference: `load-${index}-${row}` },
        earnedAt: (row % 4 < 2 ? '2026-07-10' : '2026-08-10') + 'T12:00:00+07:00',
        evidenceRef: `synthetic-load-${index}-${row}`,
        attribution: {
          kind: 'content' as const,
          contentId: row % 2 ? 'clip-3' : 'clip-1',
          evidenceRef: `synthetic-map-${index}-${row}`,
        },
        earning: {
          ...commission,
          kind: 'commission' as const,
          baseMinor: base.toString(),
          amountMinor: amount.toString(),
        },
      }));
      const controls = {
        rows: 1000,
        included: 1000,
        excluded: 0,
        unresolved: 0,
        eligibleBaseMinor: (base * 1000n).toString(),
        amountMinor: (amount * 1000n).toString(),
      };
      f.sample.file.sources[0].controls = controls;
      f.sample.context.sources[0].controls = controls;
      f.sample.context.groups = [
        {
          ...f.sample.context.groups[0],
          rows: 1000,
          baseMinor: controls.eligibleBaseMinor,
          amountMinor: controls.amountMinor,
        },
      ];
      f.sample.context.attributions = f.sample.file.rows.map((row) => {
        if (row.disposition !== 'included' || row.attribution.kind !== 'content')
          throw new Error('Expected attributed row');
        return {
          entitlement: row.entitlement,
          contentId: row.attribution.contentId,
          evidenceRef: row.attribution.evidenceRef,
        };
      });
      const imported = await f.ingest();
      await imported.publish();
      generations.push(imported.candidate.runId);
      partners.push(f);
      if ((index + 1) % 20 === 0)
        process.stdout.write(`Published synthetic finance: ${index + 1} partners\n`);
    }
    const seedMs = performance.now() - began;
    const [population] =
      await sql`select count(*)::integer as rows,count(distinct generation_id)::integer as generations,
      sum(amount_minor)::text as amount,sum(eligible_base_minor)::text as base
      from portal_imports.earning_rows where generation_id in ${sql(generations)}`;
    // Sum i=0..99 is 4950. These expectations do not call the application calculator.
    expect(population).toEqual({
      rows: 100000,
      generations: 100,
      amount: '1049600000',
      base: '10495500000',
    });

    const variants: { filters: Record<string, string>; lines: number }[] = [
      { filters: {}, lines: 1000 },
      { filters: { brand: 'Axtion' }, lines: 500 },
      { filters: { from: '2026-08-01' }, lines: 500 },
      { filters: { from: '2026-08-01', brand: 'Axtion' }, lines: 250 },
    ];
    const read = async (index: number, variant: number) => {
      const f = partners[index],
        selection = variants[variant];
      const expected = BigInt(10001 + 10 * index) * BigInt(selection.lines);
      const base = BigInt(100005 + 100 * index) * BigInt(selection.lines);
      const full = BigInt(10001 + 10 * index) * 1000n;
      const start = performance.now();
      const response = await f.request(selection.filters);
      const wire = await response.text();
      const elapsed = performance.now() - start;
      expect(response.status).toBe(200);
      const body = OverviewResponse.parse(JSON.parse(wire));
      expect(body.partnerId).toBe(f.partnerId);
      const { earnings, obligation } = body.data;
      expect(earnings.confirmed?.minor).toBe(expected.toString());
      expect(earnings.eligibleSales?.minor).toBe(base.toString());
      expect(earnings.channelBreakdown?.organic.minor).toBe(expected.toString());
      expect(earnings.channelBreakdown?.brandAds.minor).toBe('0');
      expect(earnings.trend.reduce((sum, day) => sum + BigInt(day.amount.minor), 0n)).toBe(
        expected,
      );
      expect(earnings.topContent.reduce((sum, clip) => sum + BigInt(clip.earned!.minor), 0n)).toBe(
        expected,
      );
      expect(
        earnings.salesByBrand?.reduce((sum, brand) => sum + BigInt(brand.value.minor), 0n),
      ).toBe(base);
      // The date/brand scope of earnings must not alter already-issued unpaid obligations.
      expect(obligation.confirmedUnpaid?.minor).toBe(full.toString());
      return { ms: elapsed, bytes: Buffer.byteLength(wire), index, variant };
    };
    const first = [];
    for (let start = 0; start < 100; start += 20)
      first.push(...(await Promise.all(Array.from({ length: 20 }, (_, n) => read(start + n, 0)))));
    const samples = [];
    for (let variant = 0; variant < variants.length; variant++)
      for (let start = 0; start < 100; start += 20)
        samples.push(
          ...(await Promise.all(Array.from({ length: 20 }, (_, n) => read(start + n, variant)))),
        );
    expect((await partners[0].request({ partnerId: partners[1].partnerId })).status).toBe(403);
    expect((await partners[0].request({}, new Headers())).status).toBe(401);
    expect((await partners[0].request({ permissionRevision: 'stale' })).status).toBe(403);
    expect((await partners[0].request({ generation: 'stale' })).status).toBe(409);
    const sorted = samples.map((r) => r.ms).sort((a, b) => a - b);
    const firstSorted = first.map((r) => r.ms).sort((a, b) => a - b);
    const metric = {
      partners: 100,
      rows: population.rows,
      seedMs,
      concurrency: 20,
      authPoolLimit: 2,
      requests: samples.length,
      firstPassRequests: first.length,
      firstPassP95Ms: firstSorted[94],
      p50Ms: sorted[199],
      p95Ms: sorted[379],
      maxMs: sorted[399],
      maxBytes: Math.max(...samples.map((r) => r.bytes)),
    };
    process.stdout.write('Synthetic finance measurement ' + JSON.stringify(metric) + '\n');
    expect(metric.p95Ms).toBeLessThanOrEqual(500);
    expect(metric.maxBytes).toBeLessThanOrEqual(100000);
  });
});
