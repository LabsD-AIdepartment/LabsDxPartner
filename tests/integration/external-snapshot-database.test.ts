import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import {
  createSnapshotDatabase,
  snapshotBindingKey,
} from '@/server/modules/marketing-ads/facebook/snapshot-database';
import { AdSnapshotBindingConfig } from '@/server/modules/marketing-ads/facebook/snapshot-config';
import { readStoredSnapshot } from '@/server/modules/marketing-ads/facebook/snapshot-database-runtime';
import { AdPerformanceSnapshot } from '@/contracts/ad-performance-snapshot';

const namespace = createHash('sha256').update(randomUUID()).digest('hex');
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let store: ReturnType<typeof createSnapshotDatabase>;
const binding = AdSnapshotBindingConfig.parse({
  identity: 'a',
  clipId: 'clip-3',
  profileId: 'fixture',
  namespace: 'test',
  accountId: '1',
  adId: '2',
  expectedCreativeId: '3',
  expectedVideoId: null,
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  from: '2026-07-01',
  toExclusive: '2026-09-01',
  canViewSpend: false,
});
function snapshot(fetchedAt = new Date().toISOString()) {
  const period = {
    from: binding.from + 'T00:00:00+07:00',
    toExclusive: binding.toExclusive + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok',
  };
  return AdPerformanceSnapshot.parse({
    schemaVersion: 1,
    binding: {
      identity: binding.identity,
      clipId: binding.clipId,
      namespace: binding.namespace,
      connectionId: binding.profileId,
      accountId: binding.accountId,
      adId: binding.adId,
      expectedCreativeId: binding.expectedCreativeId,
      expectedVideoId: null,
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      canViewSpend: false,
    },
    requestedPeriod: period,
    fetchedAt,
    refreshedBy: 'operator',
    report: {
      schemaVersion: 2,
      identity: {
        schemaVersion: 2,
        platform: 'facebook',
        capability: 'facebook.ad_insights',
        namespace: 'test',
        connectionId: 'fixture',
        accountId: '1',
        objectType: 'ad',
        externalId: '2',
      },
      grain: 'ad-period',
      apiVersion: 'v25.0',
      reportDefinition: 'facebook.ad-snapshot.v1',
      attribution: '7d_click+1d_view',
      actionReportTime: 'impression',
      period,
      coveredPeriod: period,
      fetchedAt,
      dataThrough: null,
      completeness: 'complete',
      nextCursor: null,
      reason: null,
      metrics: [
        {
          schemaVersion: 2,
          key: 'platform_value',
          value: '57820',
          unit: 'money',
          currency: 'THB',
          definition: 'Platform value',
          unavailableReason: null,
          aggregation: 'sum-disjoint',
        },
      ],
    },
  });
}
beforeAll(async () => {
  sql = await connectTestDatabase();
  store = createSnapshotDatabase(sql, namespace);
});
afterAll(async () => {
  // Only this test's randomly namespaced rows; no shared identity/finance fixtures touched.
  await sql`delete from portal_marketing.external_ad_snapshots where namespace_digest=${namespace}`;
  await sql.end();
});
describe('PostgreSQL external report authority', () => {
  it('deduplicates demand, seeds only exact scope, and claims a window once', async () => {
    await Promise.all([store.request(binding), store.request(binding)]);
    expect(await store.read(binding)).toBeNull();
    await store.seed(binding, snapshot());
    expect((await store.read(binding))?.stale).toBe(false);
    expect(await store.read({ ...binding, adId: '9' })).toBeNull();
    await expect(store.seed({ ...binding, adId: '9' }, snapshot())).rejects.toThrow();
    const leases = await Promise.all([store.claim([binding]), store.claim([binding])]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const lease = leases.find(Boolean)!;
    expect(await store.publish({ ...lease, token: randomUUID() }, binding, snapshot())).toBe(false);
    expect(await store.publish(lease, binding, snapshot())).toBe(true);
    expect(await store.claim([binding])).toBeNull();
    const [row] =
      await sql`select extract(epoch from(next_run_at-clock_timestamp()))::int as seconds from portal_marketing.external_ad_snapshots where namespace_digest=${namespace}`;
    expect(row.seconds).toBeGreaterThan(3590);
    expect(row.seconds).toBeLessThanOrEqual(3600);
  });
  it('retains last-good data after failure and recovers an expired lease without older overwrite', async () => {
    await sql`update portal_marketing.external_ad_snapshots set next_run_at=clock_timestamp()-interval '1 second' where namespace_digest=${namespace}`;
    const old = await store.claim([binding]);
    await sql`update portal_marketing.external_ad_snapshots set lease_until=clock_timestamp()-interval '1 second' where namespace_digest=${namespace}`;
    const recovered = await store.claim([binding]);
    expect(recovered?.token).not.toBe(old?.token);
    expect(await store.publish(old!, binding, snapshot())).toBe(false);
    await store.fail(recovered!);
    const latest = await store.read(binding);
    expect(latest?.stale).toBe(true);
    expect(AdPerformanceSnapshot.parse(latest?.raw).report.metrics[0].value).toBe('57820');
    const before = AdPerformanceSnapshot.parse(latest?.raw).fetchedAt;
    await store.seed(binding, snapshot('2026-01-01T00:00:00Z'));
    expect(AdPerformanceSnapshot.parse((await store.read(binding))?.raw).fetchedAt).toBe(before);
    expect(await createSnapshotDatabase(sql, '0'.repeat(64)).read(binding)).toBeNull();
    expect(snapshotBindingKey({ ...binding, canViewSpend: true })).toBe(
      snapshotBindingKey(binding),
    );
  });
  it('keeps retired exact-window reports readable when active demand is full', async () => {
    await sql`update portal_marketing.external_ad_snapshots set requested_at=clock_timestamp()-interval '8 days'
      where namespace_digest=${namespace}`;
    await sql`insert into portal_marketing.external_ad_snapshots(namespace_digest,binding_key,period_from,period_to)
      select ${namespace},${snapshotBindingKey(binding)},date '2026-01-01'+n,date '2026-01-02'+n from generate_series(0,127) n`;
    const previous = await store.read(binding);
    expect(previous).not.toBeNull();
    const result = await readStoredSnapshot(store, binding);
    expect(result?.raw).toEqual(previous?.raw);
    expect(result?.stale).toBe(true);
    expect(
      await readStoredSnapshot(store, {
        ...binding,
        from: '2026-06-01',
        toExclusive: '2026-07-01',
      }),
    ).toBeNull();
  });
});
