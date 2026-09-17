import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createContentHttp } from '@/server/http/content';
import { ContentHttpResponse } from '@/contracts/content-http';
import { partnerAdsSql } from '@/server/modules/marketing-ads/partner-read';
import { writeFileSync } from 'node:fs';
async function fixture() {
  const f = await setup();
  await f.catalogue();
  const c = randomUUID(),
    target = randomUUID(),
    ad = randomUUID(),
    job = randomUUID();
  const identity = {
    schemaVersion: 2,
    platform: 'facebook',
    capability: 'facebook.ad_insights',
    namespace: c,
    connectionId: c,
    accountId: '123',
    objectType: 'ad',
    externalId: '789',
  };
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at) values(${c},${c},'facebook','facebook.ad_insights','123','Mock account',true,clock_timestamp())`;
  await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref) values(${target},${f.partnerId},'clip-1','mock','Mock','Mock only')`;
  await sql`insert into portal_marketing.associations(id,target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,external_id,source_identity,creative_ids,name,created_by) values(${ad},${target},${f.partnerId},'clip-1','mock',${c},${c},'123','facebook','ad','789',${JSON.stringify(identity)}::jsonb,'["456"]','Synthetic ad',${f.staff.id})`;
  await sql`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision,state) values(${job},${ad},1,'ready')`;
  const windows: string[] = [];
  for (const day of [1, 2]) {
    const w = randomUUID(),
      g = randomUUID(),
      period = {
        from: `2026-09-0${day}T00:00:00+07:00`,
        toExclusive: `2026-09-0${day + 1}T00:00:00+07:00`,
        timezone: 'Asia/Bangkok',
      };
    const report = {
      schemaVersion: 2,
      identity,
      grain: 'ad-period',
      apiVersion: 'v25.0',
      reportDefinition: 'facebook.ad-period.v1',
      attribution: '7d_click+1d_view',
      actionReportTime: 'impression',
      period,
      coveredPeriod: period,
      fetchedAt: new Date().toISOString(),
      dataThrough: null,
      completeness: 'complete',
      nextCursor: null,
      reason: null,
      metrics: [
        {
          schemaVersion: 2,
          // A prohibited audience count: it stays in the native SourceReportV2 for staff/ingestion
          // but MUST be stripped from every Celeb-visible projection.
          key: 'impressions',
          value: day === 1 ? '11' : '13',
          unit: 'count',
          currency: null,
          definition: 'Impressions',
          aggregation: 'sum-disjoint',
          unavailableReason: null,
        },
        {
          schemaVersion: 2,
          // A Celeb-safe additive count used to assert exact wide-decimal summation still works.
          key: 'platform_orders',
          value: day === 1 ? '9007199254740993' : '7',
          unit: 'count',
          currency: null,
          definition: 'Platform orders',
          aggregation: 'sum-disjoint',
          unavailableReason: null,
        },
        {
          schemaVersion: 2,
          key: 'spend',
          value: '123.45',
          unit: 'money',
          currency: 'THB',
          definition: 'Spend',
          aggregation: 'sum-disjoint',
          unavailableReason: null,
        },
      ],
    };
    await sql`insert into portal_marketing.report_windows(id,job_id,period_from,period_to,timezone,definition,definition_hash,state,next_run_at) values(${w},${job},${period.from},${period.toExclusive},'Asia/Bangkok','{}',${'a'.repeat(64)},'ready',clock_timestamp()+interval '1 day')`;
    await sql`insert into portal_marketing.report_generations(id,window_id,report,report_sha256) values(${g},${w},${JSON.stringify(report)}::jsonb,${'b'.repeat(64)})`;
    await sql`update portal_marketing.report_windows set current_generation=${g} where id=${w}`;
    windows.push(w);
  }
  const http = createContentHttp(access, { marketingEnabled: true });
  const params = {
    partnerId: f.partnerId,
    permissionRevision: 'p1:m1',
    resource: 'ad',
    contentId: 'clip-1',
    adId: ad,
    from: '2026-09-01',
    toExclusive: '2026-09-03',
  };
  const request = (extra: Record<string, string> = {}, headers = f.viewer.headers) =>
    http(
      new Request(
        config.BETTER_AUTH_URL +
          '/api/v1/partner/content?' +
          new URLSearchParams(Object.entries({ ...params, ...extra }).filter(([, v]) => v !== '')),
        { headers },
      ),
    );
  const read = async (extra: Record<string, string> = {}) => {
    const r = await request(extra);
    expect(r.status).toBe(200);
    return ContentHttpResponse.parse(await r.json());
  };
  return { ...f, c, ad, job, windows, params, request, read };
}
describe('native partner ad reports', () => {
  it('keeps historical totals readable without declaring retired windows overdue', async () => {
    const f = await fixture();
    await sql`update portal_marketing.report_windows set next_run_at=clock_timestamp()-interval '1 day' where job_id=${f.job}`;
    expect((await f.read()).result.dataState).toBe('stale');
    await sql`update portal_marketing.sync_jobs set refresh_from='2026-09-04T00:00:00+07:00',plan_as_of=clock_timestamp() where id=${f.job}`;
    const r = await f.read();
    expect(r.result.dataState).toBe('ready');
    expect(r.result.data).toMatchObject({
      performance: {
        automaticRefreshFrom: '2026-09-03T17:00:00.000Z',
        metrics: [{ key: 'platform_orders', value: '9007199254741000' }],
      },
    });
  });

  it('paginates without duplicate ads and rejects a cursor after metric publication changes', async () => {
    const f = await fixture();
    for (let n = 0; n < 51; n++) {
      const id = randomUUID();
      await sql`insert into portal_marketing.associations(id,target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,external_id,source_identity,creative_ids,name,created_by)
        select ${id},target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,${String(1000 + n)},source_identity,creative_ids,name,created_by from portal_marketing.associations where id=${f.ad}`;
      await sql`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision) values(${randomUUID()},${id},1)`;
    }
    const one = await f.read({ resource: 'ads', adId: '' });
    const detail = await f.read({ resource: 'detail', adId: '' });
    if (detail.resource !== 'detail') throw Error('resource');
    expect(detail.result.data.adCount).toBe(52);
    if (one.resource !== 'ads') throw Error('resource');
    expect(one.result.data.items).toHaveLength(50);
    expect(one.result.data.totalCount).toBe(52);
    const cursor = one.result.data.nextCursor!;
    const two = await f.read({ resource: 'ads', adId: '', cursor });
    if (two.resource !== 'ads') throw Error('resource');
    expect(two.result.data.items).toHaveLength(2);
    expect(
      new Set([...one.result.data.items, ...two.result.data.items].map((a) => a.id)).size,
    ).toBe(52);
    await sql`update portal_meta.partner_changes set metrics=metrics+1 where partner_id=${f.partnerId}`;
    expect((await f.request({ resource: 'ads', adId: '', cursor })).status).toBe(409);
    const times: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          await f.read();
          times.push(performance.now() - start);
        }
      }),
    );
    times.sort((a, b) => a - b);
    writeFileSync(
      '.agent-work/20260910-partner-metrics/evidence/latency-' + randomUUID() + '.json',
      JSON.stringify(
        {
          environment: 'isolated local PostgreSQL/authenticated HTTP handler in process',
          ads: 52,
          reportsPerAdUnderRead: 2,
          requests: 20,
          concurrency: 4,
          p50Ms: times[9],
          p95Ms: times[18],
          samplesMs: times,
        },
        null,
        2,
      ),
    );
  });
  it('reads owned SQL snapshots with precise values, server-side spend removal and no finance publication prerequisite', async () => {
    const f = await fixture(),
      r = await f.read();
    expect(r.resource).toBe('ad');
    if (r.resource !== 'ad') throw Error('resource');
    expect(r.result.data.performance?.metrics).toEqual([
      expect.objectContaining({ key: 'platform_orders', value: '9007199254741000' }),
    ]);
    // Prohibited counts are excluded from every Celeb-visible surface (metrics, series, reasons).
    expect(r.result.data.performance?.metrics.some((m) => m.key === 'impressions')).toBe(false);
    const wire = JSON.stringify(r);
    expect(wire).not.toMatch(/spend|Spend|accountId|connectionId|namespace|impressions|Impressions/);
    expect(r.result.data.performance?.coverage.status).toBe('complete');
    const list = await f.read({ resource: 'ads', adId: '' });
    expect(list.resource).toBe('ads');
  });
  it('denies another partner, clip, stale membership and removed catalogue record', async () => {
    const f = await fixture(),
      other = await setup();
    expect((await f.request({ partnerId: other.partnerId })).status).toBe(403);
    expect((await f.request({ contentId: 'clip-2' })).status).toBe(404);
    expect((await f.request({ permissionRevision: 'p1:m9' })).status).toBe(403);
    await sql`update portal_content.clips set removed=true where partner_id=${f.partnerId} and id='clip-1'`;
    expect((await f.request()).status).toBe(404);
  });
  it('shows gaps as partial and last-good history as stale when account is paused', async () => {
    const f = await fixture();
    await sql`update portal_marketing.connections set enabled=false where id=${f.c}`;
    let r = await f.read();
    if (r.resource !== 'ad') throw Error('resource');
    expect(r.result.data.performance?.state).toBe('stale');
    await sql`update portal_marketing.report_windows set current_generation=null where id=${f.windows[1]}`;
    r = await f.read();
    if (r.resource !== 'ad') throw Error('resource');
    expect(r.result.data.performance).toMatchObject({
      state: 'partial',
      metrics: [{ value: null }],
    });
  });
  it('respects newly granted spend capability and captures one-statement query plan', async () => {
    const f = await fixture();
    await sql`update portal_access.memberships set capabilities=array_append(capabilities,'view_ad_spend'),permission_revision=permission_revision+1 where user_id=${f.viewer.id}`;
    const r = await f.read({ permissionRevision: 'p1:m2' });
    if (r.resource !== 'ad') throw Error('resource');
    expect(r.result.data.performance?.metrics.find((m) => m.key === 'spend')?.value).toBe('246.9');
    const plan = await sql.unsafe('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + partnerAdsSql, [
      f.partnerId,
      'clip-1',
      null,
      f.ad,
      null,
      null,
      '2026-09-01T00:00:00+07:00',
      '2026-09-03T00:00:00+07:00',
    ]);
    writeFileSync(
      '.agent-work/20260910-partner-metrics/evidence/explain-' + randomUUID() + '.json',
      JSON.stringify(plan, null, 2),
    );
  });
});
