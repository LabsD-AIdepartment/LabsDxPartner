/** Fixed local pilot acceptance, not a production job or a disk-cache purge. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, totalmem } from 'node:os';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { sourceForDrill } from '../../scripts/restore-drill-guards.mjs';
import { OverviewResponse } from '../../src/contracts/overview-http';
import { startRestoredHttp } from './restored-http-transport';

process.umask(0o077);
assert.equal(process.argv.length, 2);
const root = process.cwd();
const work = resolve(root, '.agent-work/20260911-cold-overview');
const run = Date.now();
const cfg = JSON.parse(
  readFileSync(
    resolve(root, '.agent-work/20260911-native-marketing/private/environment.json'),
    'utf8',
  ),
);
sourceForDrill(cfg.DATABASE_URL);
assert.equal(cfg.BETTER_AUTH_URL, 'https://127.0.0.1:4443');
Object.assign(process.env, {
  DATABASE_URL: cfg.DATABASE_URL,
  LABSD_TEST_DATABASE_URL: cfg.DATABASE_URL,
  BETTER_AUTH_URL: cfg.BETTER_AUTH_URL,
  BETTER_AUTH_SECRET: cfg.BETTER_AUTH_SECRET,
  LABSD_IDENTITY_ENABLED: '1',
  TMPDIR: resolve(work, 'tmp'),
  XDG_CACHE_HOME: resolve(work, 'cache'),
});
const build = resolve(root, '.agent-work/20260911-import-activity/build-source');
assert.equal(
  readFileSync(resolve(build, '.next/BUILD_ID'), 'utf8').trim(),
  'lDDpRieBrnD-t6G1Eiu94',
);
const sql = await connectTestDatabase();
const clients: Array<{
  index: number;
  partnerId: string;
  revision: string;
  cookie: string;
  token: string;
  sessionId: string;
}> = [];
const samples: Array<{ batch: number; index: number; variant: number; ms: number; bytes: number }> =
  [];
const processes: Array<{
  batch: number;
  readyMs: number;
  stopped: boolean;
  providerFetchAttempts: number;
}> = [];
let stage = 'fixtures',
  passed = false,
  cleanup = false;
let runtime: ReturnType<
  typeof import('../../src/server/modules/identity/runtime').getIdentityRuntime
>;
try {
  const [location] = await sql`select current_setting('data_directory') as directory`;
  assert(location.directory.endsWith('/20260911-native-marketing/pg'));
  const fixtures = await sql`with selected as (
    select distinct on(s.new_earnings_minor) s.partner_id,s.generation_id,s.new_earnings_minor,
      ((s.new_earnings_minor/1000-10001)/10)::int as index
    from portal_statements.statements s join portal_access.partners p on p.id=s.partner_id
    where p.name='Synthetic Overview partner' and p.status='active' and s.opening_minor=0 and s.adjustments_minor=0
      and s.new_earnings_minor between 10001000 and 10991000 and mod(s.new_earnings_minor-10001000,10000)=0
      and (select count(*) from portal_statements.statements other where other.partner_id=s.partner_id)=1
      and not exists(select 1 from portal_statements.settlements t where t.partner_id=s.partner_id)
    order by s.new_earnings_minor,s.published_at desc)
    select s.*,m.user_id,'p'||p.revision||':m'||m.permission_revision as revision from selected s
    join portal_access.partners p on p.id=s.partner_id join portal_access.memberships m on m.partner_id=s.partner_id
    join portal_identity.users u on u.id=m.user_id
    where m.status='active' and 'view_earnings'=any(m.capabilities) and u.username like 'overview_%'
    order by index`;
  assert.equal(fixtures.length, 100);
  assert.equal(new Set(fixtures.map((f) => f.partner_id)).size, 100);
  assert.equal(new Set(fixtures.map((f) => f.user_id)).size, 100);
  const { getIdentityRuntime } = await import('../../src/server/modules/identity/runtime');
  runtime = getIdentityRuntime()!;
  await runtime.assertBinding();
  const ctx = await runtime.auth.$context;
  for (let index = 0; index < 100; index++) {
    const f = fixtures[index];
    assert.equal(f.index, index);
    const [rows] =
      await sql`select count(*)::int as count,min(amount_minor)::text as min,max(amount_minor)::text as max,
      sum(amount_minor)::text as amount,sum(eligible_base_minor)::text as base
      from portal_imports.earning_rows where generation_id=${f.generation_id}`;
    assert.equal(rows.count, 1000);
    assert.equal(rows.min, String(10001 + 10 * index));
    assert.equal(rows.max, rows.min);
    assert.equal(rows.amount, String((10001 + 10 * index) * 1000));
    assert.equal(rows.base, String((100005 + 100 * index) * 1000));
    const session = await ctx.internalAdapter.createSession(f.user_id);
    assert(session);
    const client = {
      index,
      partnerId: f.partner_id,
      revision: f.revision,
      token: session.token,
      sessionId: session.id,
      cookie: '',
    };
    clients.push(client);
    const signature = createHmac('sha256', cfg.BETTER_AUTH_SECRET)
      .update(session.token)
      .digest('base64');
    client.cookie =
      ctx.authCookies.sessionToken.name + '=' + encodeURIComponent(session.token + '.' + signature);
  }
  stage = 'first-bursts';
  for (let batch = 0; batch < 5; batch++) {
    const launch = performance.now();
    const host = await startRestoredHttp(root, build, resolve(work, `logs/server-${run}-${batch}`));
    const readyMs = performance.now() - launch;
    try {
      assert.equal(host.buildId, 'lDDpRieBrnD-t6G1Eiu94');
      // The first requests to this new process are this entire parallel burst. No preflight GET.
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, async (_, n) => {
          const index = batch * 20 + n,
            variant = n % 4,
            client = clients[index];
          const lines = variant === 0 ? 1000 : variant === 3 ? 250 : 500;
          const from = variant >= 2 ? '2026-08-01' : '2025-09-01';
          const query = new URLSearchParams({
            partnerId: client.partnerId,
            permissionRevision: client.revision,
            from,
            toExclusive: '2026-09-01',
            ...(variant % 2 ? { brand: 'Axtion' } : {}),
          });
          const began = performance.now();
          const res = await host.request(
            new Request(cfg.BETTER_AUTH_URL + '/api/v1/partner/overview?' + query, {
              headers: { cookie: client.cookie },
            }),
          );
          assert.equal(res.status, 200);
          assert.equal(res.headers.get('cache-control'), 'private, no-store');
          const raw = await res.text(),
            body = OverviewResponse.parse(JSON.parse(raw));
          const ms = performance.now() - began;
          assert.equal(body.partnerId, client.partnerId);
          const expected = BigInt(10001 + 10 * index) * BigInt(lines);
          const base = BigInt(100005 + 100 * index) * BigInt(lines);
          const data = body.data.earnings;
          assert.equal(data.confirmed?.minor, String(expected));
          assert.equal(data.eligibleSales?.minor, String(base));
          assert.equal(data.channelBreakdown?.organic.minor, String(expected));
          assert.equal(data.channelBreakdown?.brandAds.minor, '0');
          assert.equal(
            data.trend.reduce((sum, r) => sum + BigInt(r.amount.minor), 0n),
            expected,
          );
          assert.equal(
            data.topContent.reduce((sum, r) => sum + BigInt(r.earned!.minor), 0n),
            expected,
          );
          assert.equal(
            data.salesByBrand?.reduce((sum, r) => sum + BigInt(r.value.minor), 0n),
            base,
          );
          assert.equal(
            body.data.obligation.confirmedUnpaid?.minor,
            String((10001 + 10 * index) * 1000),
          );
          samples.push({ batch, index, variant, ms, bytes: Buffer.byteLength(raw) });
        }),
      );
      assert(
        results.every((r) => r.status === 'fulfilled'),
        'First burst failed',
      );
    } finally {
      const stopped = await host.stop();
      processes.push({ batch, readyMs, ...stopped! });
    }
  }
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  assert.equal(samples.length, 100);
  assert.equal(processes.length, 5);
  assert(sorted[94] <= 1500, 'Fresh-process API p95 exceeds provisional cold budget');
  assert(samples.every((s) => s.bytes <= 100000));
  passed = true;
} catch (error) {
  console.log(
    JSON.stringify({
      status: 'failed',
      stage,
      name: error instanceof Error ? error.name : 'unknown',
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    if (runtime!) {
      const ctx = await runtime!.auth.$context;
      const removed = await Promise.allSettled(
        clients.map((c) => ctx.internalAdapter.deleteSession(c.token)),
      );
      assert(removed.every((r) => r.status === 'fulfilled'));
      if (clients.length) {
        const [remaining] =
          await sql`select count(*)::int as count from portal_identity.sessions where id=any(${clients.map((c) => c.sessionId)}::text[])`;
        assert.equal(remaining.count, 0);
      }
    }
    cleanup = true;
  } catch {
    process.exitCode = 1;
  }
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const result = {
    status: passed && cleanup ? 'passed' : 'failed',
    stage,
    run,
    kind: 'fresh-process-loopback-http-warm-database',
    partners: clients.length,
    rows: 100000,
    firstBurstConcurrency: 20,
    requests: samples.length,
    freshProcesses: processes.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
    maxMs: sorted.at(-1) ?? null,
    maxBytes: Math.max(0, ...samples.map((s) => s.bytes)),
    cleanup,
    sessionsRemoved: cleanup ? clients.length : null,
    cpu: cpus()[0]?.model,
    cpuCount: cpus().length,
    memoryBytes: totalmem(),
    processes,
    samples,
  };
  try {
    writeFileSync(resolve(work, `evidence/result-${run}.json`), JSON.stringify(result, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    console.log(JSON.stringify({ ...result, samples: undefined, processes: undefined }));
  } finally {
    await sql.end();
  }
}
