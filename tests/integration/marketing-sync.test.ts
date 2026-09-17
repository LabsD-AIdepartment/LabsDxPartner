import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { setup, sql, access } from '../helpers/partner-finance';
import { createMarketingRegistration } from '@/server/modules/marketing-ads/registration';
import {
  createMarketingProviderRegistry,
  type MarketingReadAdapter,
} from '@/server/modules/marketing-ads/provider';
import {
  createMarketingSyncStore,
  SyncSuperseded,
} from '@/server/modules/marketing-ads/sync-store';
import { dailyReportWindows } from '@/server/modules/marketing-ads/sync-plan';
import { createMarketingSyncWorker } from '@/server/modules/marketing-ads/sync-worker';
const period = {
  from: '2026-08-01T17:00:00Z',
  toExclusive: '2026-08-02T17:00:00Z',
  timezone: 'Asia/Bangkok',
};
const definition = {
  apiVersion: 'v25.0',
  reportDefinition: 'facebook.ad-period.v1',
  attribution: '7d_click+1d_view',
  actionReportTime: 'impression',
};
function report(identity: unknown, value = '9007199254740993.01') {
  return {
    schemaVersion: 2,
    identity,
    grain: 'ad-period',
    ...definition,
    period,
    coveredPeriod: period,
    fetchedAt: '2026-09-10T00:00:00Z',
    dataThrough: null,
    completeness: 'complete',
    nextCursor: null,
    reason: null,
    metrics: [
      {
        schemaVersion: 2,
        key: 'spend',
        value,
        unit: 'money',
        currency: 'THB',
        definition: 'Source spend',
        unavailableReason: null,
        aggregation: 'sum-disjoint',
      },
    ],
  };
}
async function fixture() {
  const f = await setup();
  await f.catalogue();
  const connectionId = randomUUID(),
    targetId = randomUUID();
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
    values(${connectionId},'sync-test','facebook','facebook.ad_insights',${randomUUID()},'Synthetic',true,clock_timestamp())`;
  await sql`insert into portal_marketing.connection_grants values(${connectionId},${f.staff.id})`;
  await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
    values(${targetId},${f.partnerId},'clip-1','mock','Mock','mock-only')`;
  const adapter: MarketingReadAdapter = {
    capability: 'facebook.ad_insights',
    resolve: async (identity) => ({
      schemaVersion: 2,
      identity,
      apiVersion: 'v25.0',
      sourceRevision: null,
      name: 'Synthetic',
      creativeIds: ['creative-1'],
      fetchedAt: new Date().toISOString(),
    }),
    report: async (identity) => report(identity),
  };
  const providers = createMarketingProviderRegistry([adapter]),
    service = createMarketingRegistration(access, providers);
  const draft = {
    targetId,
    connectionId,
    platform: 'facebook' as const,
    externalId: '123456789012345678901',
  };
  const command = { actorId: f.staff.id, permissionRevision: '1', draft };
  const receipt = await service.resolve(f.staff.headers, command, new AbortController().signal);
  const saved = await service.save(f.staff.headers, {
    ...command,
    receipt: receipt.receipt,
    idempotencyKey: randomUUID(),
  });
  const [job] =
    await sql`select id from portal_marketing.sync_jobs where association_id=${saved.associationId}`;
  const store = createMarketingSyncStore(sql);
  const windowId = await store.schedule(job.id, period, definition);
  const claim = () => store.claim([connectionId]);
  const due = () =>
    sql`update portal_marketing.report_windows set next_run_at=clock_timestamp()-interval '1 second' where id=${windowId}`;
  const read = async () => {
    const [row] =
      await sql`select w.*,g.report,g.report_sha256 from portal_marketing.report_windows w
    left join portal_marketing.report_generations g on g.id=w.current_generation where w.id=${windowId}`;
    return row;
  };
  return {
    ...f,
    store,
    adapter,
    providers,
    connectionId,
    targetId,
    jobId: String(job.id),
    windowId,
    claim,
    due,
    read,
  };
}
describe('durable marketing report queue', () => {
  it('runs registration -> worker -> exact generation and scoped change metadata, without changing finance', async () => {
    const f = await fixture();
    const [before] =
      await sql`select * from portal_meta.partner_changes where partner_id=${f.partnerId}`;
    expect(
      await createMarketingSyncWorker(f.store, f.providers)(
        [f.connectionId],
        new AbortController().signal,
      ),
    ).toEqual({ state: 'published' });
    const row = await f.read();
    expect(row.state).toBe('ready');
    expect(row.report.metrics[0].value).toBe('9007199254740993.01');
    expect(row.report.dataThrough).toBeNull();
    const [after] =
      await sql`select * from portal_meta.partner_changes where partner_id=${f.partnerId}`;
    expect(BigInt(after.metrics)).toBe(BigInt(before.metrics) + 1n);
    expect(after.earnings).toBe(before.earnings);
    expect(after.settlements).toBe(before.settlements);
    expect(await f.claim()).toBeNull();
    await expect(
      sql`update portal_marketing.report_generations set report='{}' where id=${row.current_generation}`,
    ).rejects.toThrow();
  });
  it('deduplicates schedules, serializes workers on one account, survives service recreation', async () => {
    const f = await fixture();
    expect(await f.store.schedule(f.jobId, period, definition)).toBe(f.windowId);
    await f.store.schedule(
      f.jobId,
      { ...period, from: '2026-08-02T17:00:00Z', toExclusive: '2026-08-03T17:00:00Z' },
      definition,
    );
    const results = await Promise.all([
      f.claim(),
      createMarketingSyncStore(sql).claim([f.connectionId]),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await f.claim()).toBeNull();
    const lease = results.find(Boolean)!;
    await f.store.fail(lease, 'temporary');
    const next = await f.claim();
    expect(next).not.toBeNull();
    expect(next?.windowId).not.toBe(lease.windowId);
  });
  it('reclaims an expired lease and fences the old owner from publish and release', async () => {
    const f = await fixture(),
      old = (await f.claim())!;
    await sql`update portal_marketing.report_windows set lease_until=clock_timestamp()-interval '1 second' where id=${f.windowId}`;
    await sql`update portal_marketing.connection_runtime set lease_until=clock_timestamp()-interval '1 second' where connection_id=${f.connectionId}`;
    const next = (await createMarketingSyncStore(sql).claim([f.connectionId]))!;
    expect(next.token).not.toBe(old.token);
    expect(next.attempt).toBe(2);
    await expect(f.store.publish(old, report(old.identity))).rejects.toBeInstanceOf(SyncSuperseded);
    expect(await f.store.fail(old, 'temporary')).toBe(false);
    await f.store.publish(next, report(next.identity));
    expect((await f.read()).state).toBe('ready');
  });
  it('retains last-good on partial acquisition and replaces a late correction without adding it', async () => {
    const f = await fixture(),
      lease = (await f.claim())!;
    const first = await f.store.publish(lease, report(lease.identity, '100.01'));
    await f.due();
    f.adapter.report = async (identity) => ({
      ...report(identity),
      completeness: 'partial',
      coveredPeriod: null,
      nextCursor: 'next',
      reason: 'Not complete',
      metrics: [],
    });
    expect(
      await createMarketingSyncWorker(f.store, f.providers)(
        [f.connectionId],
        new AbortController().signal,
      ),
    ).toEqual({ state: 'retry' });
    expect((await f.read()).current_generation).toBe(first);
    expect((await f.read()).issue).toBe('incomplete');
    await f.due();
    const next = (await f.claim())!;
    const second = await f.store.publish(next, report(next.identity, '90.01'));
    expect(second).not.toBe(first);
    expect((await f.read()).report.metrics[0].value).toBe('90.01');
    const generations =
      await sql`select id from portal_marketing.report_generations where window_id=${f.windowId}`;
    expect(generations).toHaveLength(2);
  });
  it.each(['connection', 'target', 'partner', 'clip', 'revision'])(
    'fences a %s change during source I/O',
    async (change) => {
      const f = await fixture(),
        lease = (await f.claim())!;
      if (change === 'connection')
        await sql`update portal_marketing.connections set enabled=false where id=${f.connectionId}`;
      if (change === 'target')
        await sql`update portal_marketing.targets set active=false where id=${f.targetId}`;
      if (change === 'partner')
        await sql`update portal_access.partners set status='suspended' where id=${f.partnerId}`;
      if (change === 'clip')
        await sql`update portal_content.clips set removed=true where partner_id=${f.partnerId} and id='clip-1'`;
      if (change === 'revision')
        await sql`update portal_marketing.targets set agreement_label='Changed' where id=${f.targetId}`;
      await expect(f.store.publish(lease, report(lease.identity))).rejects.toBeInstanceOf(
        SyncSuperseded,
      );
      expect((await f.read()).current_generation).toBeNull();
    },
  );
  it('rejects incomplete, wrong-period, wrong-definition and wrong-identity publication', async () => {
    const f = await fixture(),
      lease = (await f.claim())!;
    const good = report(lease.identity);
    for (const bad of [
      { ...good, reportDefinition: 'other' },
      { ...good, identity: { ...lease.identity, externalId: 'other' } },
      {
        ...good,
        completeness: 'unavailable',
        reason: 'No source',
        coveredPeriod: null,
        metrics: [],
      },
      {
        ...good,
        period: { ...period, from: '2026-08-01T16:00:00Z' },
        coveredPeriod: { ...period, from: '2026-08-01T16:00:00Z' },
      },
    ])
      await expect(f.store.publish(lease, bad)).rejects.toThrow();
    expect((await f.read()).current_generation).toBeNull();
  });
  it('persists throttle cooldown across workers and does not block a different account', async () => {
    const a = await fixture(),
      b = await fixture(),
      lease = (await a.claim())!;
    await a.store.fail(lease, 'throttled', 600_000);
    await a.due();
    expect(await createMarketingSyncStore(sql).claim([a.connectionId])).toBeNull();
    const other = await b.claim();
    expect(other?.connectionId).toBe(b.connectionId);
    expect((await a.read()).issue).toBe('throttled');
  });
  it('requires configured claim scope and active references; staff departure does not cancel an agreed binding', async () => {
    const f = await fixture();
    expect(await f.store.claim([])).toBeNull();
    expect(await f.store.claim(['unconfigured'])).toBeNull();
    await sql`delete from portal_marketing.connection_grants where connection_id=${f.connectionId}`;
    expect(await f.claim()).not.toBeNull();
  });
  it('leaves actionable sanitized failures and catches creative reassignment before reporting', async () => {
    const f = await fixture();
    let reports = 0;
    f.adapter.resolve = async (identity) => ({
      schemaVersion: 2,
      identity,
      apiVersion: 'v25.0',
      sourceRevision: null,
      name: 'Changed',
      creativeIds: ['creative-2'],
      fetchedAt: new Date().toISOString(),
    });
    f.adapter.report = async (identity) => {
      reports++;
      return report(identity);
    };
    expect(
      await createMarketingSyncWorker(f.store, f.providers)(
        [f.connectionId],
        new AbortController().signal,
      ),
    ).toEqual({ state: 'needs-attention' });
    expect(reports).toBe(0);
    expect((await f.read()).state).toBe('needs-attention');
    expect((await f.read()).issue).toBe('invalid-source');
    expect(await f.claim()).toBeNull();
  });
  it('aborts a noncooperative adapter without retaining a database transaction or publishing late', async () => {
    const f = await fixture(),
      controller = new AbortController();
    let entered!: () => void, release!: (value: unknown) => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    f.adapter.report = () => {
      entered();
      return new Promise((r) => {
        release = r;
      });
    };
    const running = createMarketingSyncWorker(f.store, f.providers)(
      [f.connectionId],
      controller.signal,
    );
    await started;
    // If source I/O held the connection row in a transaction this mutation would wait.
    await sql`update portal_marketing.connections set label='Changed during fetch' where id=${f.connectionId}`;
    controller.abort();
    expect(await running).toEqual({ state: 'retry' });
    release({});
    expect((await f.read()).current_generation).toBeNull();
    expect((await f.read()).issue).toBe('temporary');
  });
  it.each(['creative', 'revision'])(
    'fences a source %s change after report acquisition',
    async (changed) => {
      const f = await fixture(),
        original = f.adapter.resolve;
      f.adapter.report = async (identity) => {
        f.adapter.resolve = async (identity, signal) => ({
          ...((await original(identity, signal)) as object),
          ...(changed === 'creative' ? { creativeIds: ['changed'] } : { sourceRevision: 'new' }),
        });
        return report(identity);
      };
      expect(
        await createMarketingSyncWorker(f.store, f.providers)(
          [f.connectionId],
          new AbortController().signal,
        ),
      ).toEqual({ state: changed === 'creative' ? 'needs-attention' : 'retry' });
      expect((await f.read()).current_generation).toBeNull();
      expect((await f.read()).issue).toBe(changed === 'creative' ? 'invalid-source' : 'temporary');
    },
  );
  it('rolls back generation, pointer and metric revision together on commit failure', async () => {
    const f = await fixture(),
      lease = (await f.claim())!;
    const wrapped = new Proxy(sql, {
      get(target, property, receiver) {
        if (property !== 'begin') return Reflect.get(target, property, receiver);
        return (callback: (tx: TransactionSql) => Promise<unknown>) =>
          sql.begin(async (tx) => {
            await callback(tx);
            throw new Error('Synthetic commit failure');
          });
      },
    });
    await expect(
      createMarketingSyncStore(wrapped).publish(lease, report(lease.identity)),
    ).rejects.toThrow('Synthetic commit failure');
    expect((await f.read()).current_generation).toBeNull();
    expect(
      await sql`select * from portal_marketing.report_generations where window_id=${f.windowId}`,
    ).toHaveLength(0);
  });
});

describe('rolling refresh horizon with retained history', () => {
  const at = Date.parse('2026-08-04T00:00:00Z');
  const windows = (now: number, days = 2) =>
    dailyReportWindows('Asia/Bangkok', now, days).map(({ period, refreshSeconds }) => ({
      period,
      refreshSeconds,
    }));
  it('retains old exact reports but never claims them again after planning and store restart', async () => {
    const f = await fixture(),
      lease = (await f.claim())!;
    await f.store.publish(lease, report(lease.identity));
    const original = await f.read();
    await f.due();
    expect(await f.store.plan(f.jobId, windows(at), definition, at)).toBe(2);
    const saved = await f.read();
    expect(saved.current_generation).toBe(original.current_generation);
    expect(saved.report).toEqual(original.report);
    await sql`update portal_marketing.report_windows set next_run_at=clock_timestamp()+interval '1 day' where job_id=${f.jobId} and id<>${f.windowId}`;
    expect(await createMarketingSyncStore(sql).claim([f.connectionId])).toBeNull();
    const [job] = await sql`select * from portal_marketing.sync_jobs where id=${f.jobId}`;
    expect(new Date(job.refresh_from).toISOString()).toBe('2026-08-02T17:00:00.000Z');
    expect(job.last_success_at).not.toBeNull();
  });
  it('allows an already leased old window to finish once without restoring recurring work', async () => {
    const f = await fixture(),
      lease = (await f.claim())!;
    await f.store.plan(f.jobId, windows(at), definition, at);
    await expect(f.store.publish(lease, report(lease.identity))).resolves.toBeTypeOf('string');
    await f.due();
    await sql`update portal_marketing.report_windows set next_run_at=clock_timestamp()+interval '1 day' where job_id=${f.jobId} and id<>${f.windowId}`;
    expect(await f.claim()).toBeNull();
  });
  it('serializes competing planners and rejects an older plan without reviving old windows', async () => {
    const f = await fixture(),
      newer = at + 86400_000;
    await Promise.all([
      f.store.plan(f.jobId, windows(at), definition, at),
      f.store.plan(f.jobId, windows(newer), definition, newer),
    ]);
    expect(await f.store.plan(f.jobId, windows(at, 9), definition, at)).toBe(0);
    const [job] =
      await sql`select refresh_from,plan_as_of from portal_marketing.sync_jobs where id=${f.jobId}`;
    expect(new Date(job.plan_as_of).getTime()).toBe(newer);
    expect(new Date(job.refresh_from).toISOString()).toBe('2026-08-03T17:00:00.000Z');
    const claimed = (await f.claim())!;
    expect(Date.parse(claimed.period.from)).toBeGreaterThanOrEqual(
      Date.parse('2026-08-03T17:00:00Z'),
    );
  });
  it('rejects gaps and cancellation without leaving half a plan; can explicitly extend the horizon later', async () => {
    const f = await fixture(),
      rows = windows(at, 3),
      controller = new AbortController();
    await expect(f.store.plan(f.jobId, [rows[0], rows[2]], definition, at)).rejects.toThrow(
      'contiguous',
    );
    controller.abort();
    await expect(f.store.plan(f.jobId, rows, definition, at, controller.signal)).rejects.toThrow();
    const [before] =
      await sql`select count(*)::int as n from portal_marketing.report_windows where job_id=${f.jobId}`;
    expect(before.n).toBe(1);
    await f.store.plan(f.jobId, windows(at), definition, at);
    await f.store.plan(f.jobId, windows(at + 1, 8), definition, at + 1);
    const [job] =
      await sql`select refresh_from from portal_marketing.sync_jobs where id=${f.jobId}`;
    expect(new Date(job.refresh_from).toISOString()).toBe('2026-07-27T17:00:00.000Z');
  });
});
