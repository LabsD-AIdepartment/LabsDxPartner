import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup, sql, access } from '../helpers/partner-finance';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
import { OverviewResponse } from '@/contracts/overview-http';
import { createOverviewReader } from '@/server/modules/earnings/overview';
import { startRestoredHttp } from '../helpers/restored-http-transport';
import { sourceForDrill } from '../../scripts/restore-drill-guards.mjs';

const rowsPerMonth = 5000;
const monthDate = (month: number) =>
  new Date(Date.UTC(2024, 8 + month, 1)).toISOString().slice(0, 10);
const scopes: Array<{ from: string; toExclusive: string; brand?: string }> = [
  { from: '2025-09-01', toExclusive: '2026-09-01' },
  { from: '2024-09-01', toExclusive: '2025-09-01' },
  { from: '2025-08-15', toExclusive: '2025-10-16' },
  { from: '2025-09-01', toExclusive: '2026-09-01', brand: 'Axtion' },
  { from: '2025-08-15', toExclusive: '2025-10-16', brand: 'Axtion' },
];

function controls(scope: { from: string; toExclusive: string; brand?: string }) {
  const days = new Map<string, bigint>();
  const clips = new Map<string, bigint>();
  const brands = new Map<string, bigint>();
  let amount = 0n,
    base = 0n;
  // Closed-form per-line amounts: do not call the importer or production calculator.
  for (let month = 0; month < 24; month++)
    for (let row = 0; row < rowsPerMonth; row++) {
      const day = monthDate(month).slice(0, 8) + String((row % 28) + 1).padStart(2, '0');
      const brand = row % 2 ? 'Tendrix' : 'Axtion';
      if (day < scope.from || day >= scope.toExclusive || (scope.brand && scope.brand !== brand))
        continue;
      const earned = BigInt(10001 + 10 * month),
        sales = BigInt(100005 + 100 * month);
      amount += earned;
      base += sales;
      days.set(day, (days.get(day) ?? 0n) + earned);
      const clip = row % 2 ? 'clip-3' : 'clip-1';
      clips.set(clip, (clips.get(clip) ?? 0n) + earned);
      brands.set(brand, (brands.get(brand) ?? 0n) + sales);
    }
  return { amount, base, days, clips, brands };
}

describe('multi-period financial history', () => {
  it('reconciles 24 issued months and exact daily graphs under 20 concurrent reads', async () => {
    const run = Date.now(),
      work = resolve('.agent-work/20260911-finance-history');
    const build = resolve(work, 'build-source');
    expect(readFileSync(resolve(build, 'src/server/modules/earnings/overview.ts'), 'utf8')).toBe(
      readFileSync(resolve('src/server/modules/earnings/overview.ts'), 'utf8'),
    );
    const envKeys = [
      'DATABASE_URL',
      'BETTER_AUTH_URL',
      'BETTER_AUTH_SECRET',
      'LABSD_IDENTITY_ENABLED',
      'TMPDIR',
      'XDG_CACHE_HOME',
    ];
    const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    let native: Awaited<ReturnType<typeof startRestoredHttp>> | undefined;
    let cleanupNative: (() => Promise<void>) | undefined;
    try {
      const f = await setup({ sessionFixture: 'persisted' });
      const catalogue = celebrityCatalogue(f.partnerId);
      catalogue.clips.forEach((clip) => {
        clip.publishedAt = '2024-08-01T00:00:00Z';
      });
      await f.catalogue(catalogue);
      const template = structuredClone(f.sample.file.rows[0]);
      if (template.disposition !== 'included' || template.earning.kind !== 'commission')
        throw Error('Expected commission');
      const earning = template.earning;
      const generations: string[] = [];
      const began = performance.now();
      for (let month = 0; month < 24; month++) {
        const period = {
          from: monthDate(month) + 'T00:00:00+07:00',
          toExclusive: monthDate(month + 1) + 'T00:00:00+07:00',
          timezone: 'Asia/Bangkok' as const,
        };
        f.sample.file.period = period;
        f.sample.context.period = period;
        f.sample.file.rows = Array.from({ length: rowsPerMonth }, (_, row) => ({
          ...template,
          entitlement: { ...template.entitlement, reference: `history-${month}-${row}` },
          earnedAt:
            monthDate(month).slice(0, 8) +
            String((row % 28) + 1).padStart(2, '0') +
            'T12:00:00+07:00',
          evidenceRef: `synthetic-history-${month}-${row}`,
          attribution: {
            kind: 'content' as const,
            contentId: row % 2 ? 'clip-3' : 'clip-1',
            evidenceRef: `synthetic-history-map-${month}-${row}`,
          },
          earning: {
            ...earning,
            baseMinor: String(100005 + 100 * month),
            amountMinor: String(10001 + 10 * month),
          },
        }));
        const sourceControls = {
          rows: rowsPerMonth,
          included: rowsPerMonth,
          excluded: 0,
          unresolved: 0,
          eligibleBaseMinor: String(BigInt(100005 + 100 * month) * BigInt(rowsPerMonth)),
          amountMinor: String(BigInt(10001 + 10 * month) * BigInt(rowsPerMonth)),
        };
        f.sample.file.sources[0] = {
          ...f.sample.file.sources[0],
          asOf: period.toExclusive,
          controls: sourceControls,
        };
        f.sample.context.sources[0] = { ...f.sample.file.sources[0] };
        f.sample.context.groups = [
          {
            ...f.sample.context.groups[0],
            effective: period,
            calculationWindow: period,
            rows: rowsPerMonth,
            baseMinor: sourceControls.eligibleBaseMinor,
            amountMinor: sourceControls.amountMinor,
          },
        ];
        f.sample.context.attributions = f.sample.file.rows.map((row) => {
          if (row.disposition !== 'included' || row.attribution.kind !== 'content')
            throw Error('Expected content');
          return {
            entitlement: row.entitlement,
            contentId: row.attribution.contentId,
            evidenceRef: row.attribution.evidenceRef,
          };
        });
        const imported = await f.ingest();
        await imported.publish();
        generations.push(imported.candidate.runId);
        if ((month + 1) % 6 === 0) process.stdout.write(`Published history: ${month + 1} months\n`);
      }
      const seedMs = performance.now() - began;
      const [population] =
        await sql`select count(*)::int as rows,count(distinct generation_id)::int as generations,
      sum(amount_minor)::text as amount,sum(eligible_base_minor)::text as base from portal_imports.earning_rows where generation_id in ${sql(generations)}`;
      // Sum months 0..23 =276; per-line rounding differs from rounding a whole period by2500minor.
      const fullAmount = BigInt(rowsPerMonth) * (24n * 10001n + 10n * 276n);
      const fullBase = BigInt(rowsPerMonth) * (24n * 100005n + 100n * 276n);
      expect(population).toEqual({
        rows: 120000,
        generations: 24,
        amount: String(fullAmount),
        base: String(fullBase),
      });
      const expected = scopes.map(controls);
      // Match the actual application's max10 identity/query pool; the fixture helper's
      // max2 pool is a setup resource limit, not the deployed API configuration.
      const cfg = JSON.parse(
        readFileSync(
          resolve('.agent-work/20260911-native-marketing/private/environment.json'),
          'utf8',
        ),
      );
      sourceForDrill(cfg.DATABASE_URL);
      expect(cfg.DATABASE_URL).toBe(process.env.LABSD_TEST_DATABASE_URL);
      expect(cfg.BETTER_AUTH_URL).toBe('https://127.0.0.1:4443');
      Object.assign(process.env, {
        DATABASE_URL: cfg.DATABASE_URL,
        BETTER_AUTH_URL: cfg.BETTER_AUTH_URL,
        BETTER_AUTH_SECRET: cfg.BETTER_AUTH_SECRET,
        LABSD_IDENTITY_ENABLED: '1',
        TMPDIR: resolve(work, 'tmp'),
        XDG_CACHE_HOME: resolve(work, 'cache'),
      });
      const { getIdentityRuntime } = await import('@/server/modules/identity/runtime');
      const runtime = getIdentityRuntime()!;
      await runtime.assertBinding();
      const ctx = await runtime.auth.$context;
      const session = await ctx.internalAdapter.createSession(f.viewer.id);
      expect(session).toBeTruthy();
      cleanupNative = async () => {
        await ctx.internalAdapter.deleteSession(session!.token);
        const [remaining] =
          await sql`select count(*)::int as count from portal_identity.sessions where id=${session!.id}`;
        expect(remaining.count).toBe(0);
      };
      const signature = createHmac('sha256', cfg.BETTER_AUTH_SECRET)
        .update(session!.token)
        .digest('base64');
      const cookie =
        ctx.authCookies.sessionToken.name +
        '=' +
        encodeURIComponent(session!.token + '.' + signature);
      native = await startRestoredHttp(resolve('.'), build, resolve(work, `logs/native-${run}`));
      const nativeRequest = (extra: Record<string, string>) =>
        native!.request(
          new Request(
            cfg.BETTER_AUTH_URL +
              '/api/v1/partner/overview?' +
              new URLSearchParams({ ...f.params, ...extra }),
            { headers: { cookie } },
          ),
        );
      const read = async (variant: number) => {
        const start = performance.now();
        const selected = scopes[variant];
        const res = await nativeRequest({
          from: selected.from,
          toExclusive: selected.toExclusive,
          ...(selected.brand ? { brand: selected.brand } : {}),
        });
        const raw = await res.text(),
          ms = performance.now() - start;
        expect(res.status).toBe(200);
        const body = OverviewResponse.parse(JSON.parse(raw));
        expect(body.partnerId).toBe(f.partnerId);
        const e = body.data.earnings,
          c = expected[variant];
        expect(e.coverage.status).toBe('complete');
        expect(e.confirmed?.minor).toBe(String(c.amount));
        expect(e.eligibleSales?.minor).toBe(String(c.base));
        expect(e.channelBreakdown?.organic.minor).toBe(String(c.amount));
        expect(e.channelBreakdown?.brandAds.minor).toBe('0');
        expect(e.trend.map((day) => [day.date, day.amount.minor])).toEqual(
          [...c.days]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([day, amount]) => [day, String(amount)]),
        );
        expect(
          Object.fromEntries(e.topContent.map((clip) => [clip.id, clip.earned?.minor])),
        ).toEqual(Object.fromEntries([...c.clips].map(([clip, amount]) => [clip, String(amount)])));
        expect(
          Object.fromEntries(
            (e.salesByBrand ?? []).map((brand) => [brand.label, brand.value.minor]),
          ),
        ).toEqual(
          Object.fromEntries([...c.brands].map(([brand, amount]) => [brand, String(amount)])),
        );
        expect(body.data.obligation.confirmedUnpaid?.minor).toBe(String(fullAmount));
        return { variant, ms, bytes: Buffer.byteLength(raw), trendPoints: e.trend.length };
      };
      for (let variant = 0; variant < scopes.length; variant++) await read(variant);
      const samples: Awaited<ReturnType<typeof read>>[] = [];
      for (let burst = 0; burst < 5; burst++) {
        const results = await Promise.allSettled(
          Array.from({ length: 20 }, (_, n) => read(n % scopes.length)),
        );
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
        for (const r of results) if (r.status === 'fulfilled') samples.push(r.value);
      }

      // Observe only the data SELECT inside the already-authorized partner transaction.
      // No global query debug hook: auth/session SQL and arguments are never captured.
      const plans: unknown[] = [];
      const observedAccess: typeof access = {
        ...access,
        withPartner: (headers, partnerId, capability, readData) =>
          access.withPartner(headers, partnerId, capability, (tx, scope) =>
            readData(
              new Proxy(tx, {
                get(target, key, receiver) {
                  if (key !== 'unsafe') return Reflect.get(target, key, receiver);
                  return async (...args: Parameters<typeof tx.unsafe>) => {
                    expect(args[0].startsWith('with pubs as materialized')).toBe(true);
                    const result = await target.unsafe(...args);
                    const plan = await target.unsafe(
                      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + args[0],
                      args[1],
                    );
                    plans.push(plan[0]['QUERY PLAN']);
                    return result;
                  };
                },
              }),
              scope,
            ),
          ),
      };
      for (const variant of [0, 2, 3])
        await createOverviewReader(observedAccess)(f.viewer.headers, {
          ...f.params,
          ...scopes[variant],
        });
      expect(plans).toHaveLength(3);
      const unavailable = await f.read({ from: '2024-07-01', toExclusive: '2024-09-01' });
      expect(unavailable.data.earnings.confirmed).toBeNull();
      expect(unavailable.data.obligation.confirmedUnpaid?.minor).toBe(String(fullAmount));
      expect((await f.request({ from: '2024-09-01', toExclusive: '2026-09-01' })).status).toBe(400);
      const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
      const result = {
        run,
        partnerId: f.partnerId,
        generations,
        population,
        seedMs,
        periods: 24,
        requests: samples.length,
        concurrency: 20,
        kind: 'built-native-loopback-http',
        buildId: native.buildId,
        identityPoolMax: 10,
        p95Ms: sorted[94],
        maxMs: sorted.at(-1),
        maxBytes: Math.max(...samples.map((s) => s.bytes)),
        samples,
        plans,
      };
      writeFileSync(
        resolve(work, `evidence/history-${run}.json`),
        JSON.stringify(result, null, 2),
        {
          flag: 'wx',
          mode: 0o600,
        },
      );
      process.stdout.write(
        'History measurement ' +
          JSON.stringify({
            ...result,
            partnerId: undefined,
            generations: undefined,
            samples: undefined,
            plans: undefined,
          }) +
          '\n',
      );
      expect(result.p95Ms).toBeLessThanOrEqual(500);
      expect(result.maxBytes).toBeLessThanOrEqual(100000);
    } finally {
      try {
        if (native) await native.stop();
      } finally {
        try {
          if (cleanupNative) await cleanupNative();
        } finally {
          for (const key of envKeys) {
            const value = previousEnv[key];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        }
      }
    }
  });
});
