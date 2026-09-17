import { it, expect, describe, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql } from '../helpers/partner-finance';
import { createFacebookQuota } from '@/server/modules/marketing-ads/facebook/quota';
import type { FacebookProfile } from '@/server/modules/marketing-ads/facebook/config';
import { createConfiguredMarketingProviders } from '@/server/modules/marketing-ads/composition';
import { createFacebookGraph } from '@/server/modules/marketing-ads/facebook/graph';
import { planNextMarketingJob } from '@/server/modules/marketing-ads/sync-plan';
import { runMarketingSyncCycle } from '@/server/modules/marketing-ads/sync-cycle';
async function connection() {
  const p: FacebookProfile = {
    id: randomUUID(),
    namespace: randomUUID(),
    accountId: '123456',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    acquisitionOwner: 'portal-direct',
    tokenEnv: 'LABSD_FB_TEST_TOKEN',
  };
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
    values(${p.id},${p.namespace},'facebook','facebook.ad_insights',${p.accountId},'Synthetic',true,clock_timestamp())`;
  return p;
}
const signal = () => new AbortController().signal;
beforeEach(async () => {
  await sql`delete from portal_marketing.request_limits`;
});
describe('shared native source runtime', () => {
  it('persists account cooldown without blocking an unrelated account', async () => {
    const a = await connection(),
      b = await connection(),
      quota = createFacebookQuota(sql, [a, b], async () => {});
    await quota.recordUsage(a.id, { percent: 90, retryAfterMs: 600000 });
    await expect(
      createFacebookQuota(sql, [a, b], async () => {}).beforeRequest(a.id, signal()),
    ).rejects.toMatchObject({ code: 'throttled' });
    await expect(quota.beforeRequest(b.id, signal())).resolves.toBeUndefined();
  });
  it('shares app cooldown across accounts and lower usage cannot clear it', async () => {
    const a = await connection(),
      b = await connection(),
      quota = createFacebookQuota(sql, [a, b], async () => {});
    await quota.recordUsage(a.id, { percent: 90, appPercent: 90, retryAfterMs: 60000 });
    await quota.recordUsage(a.id, { percent: 0, retryAfterMs: 0 });
    await expect(quota.beforeRequest(b.id, signal())).rejects.toMatchObject({ code: 'throttled' });
  });
  it('paces concurrent requests across recreated instances and cancellation does not reserve a slot', async () => {
    const a = await connection(),
      quota = createFacebookQuota(sql, [a], async () => {});
    const start = Date.now();
    await Promise.all([
      quota.beforeRequest(a.id, signal()),
      createFacebookQuota(sql, [a], async () => {}).beforeRequest(a.id, signal()),
    ]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(450);
    await sql`update portal_marketing.request_limits set next_at=clock_timestamp()+interval '30 seconds'`;
    const controller = new AbortController(),
      pending = quota.beforeRequest(a.id, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
  it('rejects absent/disabled/mismatched connections and namespace failure before network', async () => {
    const a = await connection();
    await expect(
      createFacebookQuota(sql, [a], async () => {
        throw new Error('binding');
      }).beforeRequest(a.id, signal()),
    ).rejects.toThrow('binding');
    await expect(
      createFacebookQuota(sql, [{ ...a, accountId: 'other' }], async () => {}).beforeRequest(
        a.id,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'access' });
    await sql`update portal_marketing.connections set enabled=false where id=${a.id}`;
    await expect(
      createFacebookQuota(sql, [a], async () => {}).beforeRequest(a.id, signal()),
    ).rejects.toMatchObject({ code: 'access' });
  });
  it.each([429, 200])(
    'persists source throttle in lookup requests with status %s',
    async (status) => {
      const a = await connection(),
        quota = createFacebookQuota(sql, [a], async () => {});
      const graph = createFacebookGraph({
        ...quota,
        credential: async () => ({ token: 'synthetic' }),
        fetch: async () =>
          Response.json({ error: { code: 4, message: 'private-source-message' } }, { status }),
      });
      await expect(graph(a.id, '123456', {}, signal())).rejects.toMatchObject({
        code: 'throttled',
      });
      await expect(quota.beforeRequest(a.id, signal())).rejects.toMatchObject({
        code: 'throttled',
      });
    },
  );
  it.each(['ACTIVE', 'PAUSED', 'ARCHIVED'])(
    'connects native planner -> adapter -> publication for %s with fake upstream only',
    async (effective_status) => {
      const f = await setup();
      await f.catalogue();
      const p = await connection(),
        targetId = randomUUID(),
        associationId = randomUUID(),
        jobId = randomUUID();
      const identity = {
        schemaVersion: 2,
        platform: 'facebook',
        capability: 'facebook.ad_insights',
        namespace: p.namespace,
        connectionId: p.id,
        accountId: p.accountId,
        objectType: 'ad',
        externalId: '789',
      };
      await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
      values(${targetId},${f.partnerId},'clip-1','mock','Mock','Mock only')`;
      await sql`insert into portal_marketing.associations(id,target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,external_id,source_identity,creative_ids,name,created_by)
      values(${associationId},${targetId},${f.partnerId},'clip-1','mock',${p.id},${p.namespace},${p.accountId},'facebook','ad','789',${JSON.stringify(identity)}::jsonb,'["456"]','Synthetic',${f.staff.id})`;
      await sql`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision) values(${jobId},${associationId},1)`;
      const calls: string[] = [];
      const native = createConfiguredMarketingProviders(
        sql,
        {
          LABSD_FACEBOOK_READ_ENABLED: '1',
          LABSD_FACEBOOK_PROFILES: JSON.stringify([p]),
          LABSD_FB_TEST_TOKEN: 'synthetic-only',
        },
        async () => {},
        {
          now: () => Date.parse('2026-09-10T00:00:00Z'),
          fetch: async (input) => {
            const url = new URL(String(input));
            calls.push(url.pathname);
            if (url.pathname.endsWith('/act_123456'))
              return Response.json({
                id: 'act_123456',
                account_id: '123456',
                currency: 'THB',
                timezone_name: 'Asia/Bangkok',
              });
            if (url.pathname.endsWith('/insights'))
              return Response.json({
                data: [
                  {
                    ad_id: '789',
                    account_id: '123456',
                    account_currency: 'THB',
                    date_start: '2026-09-10',
                    date_stop: '2026-09-10',
                    spend: '99.99',
                  },
                ],
              });
            return Response.json({
              id: '789',
              account_id: '123456',
              name: 'Synthetic',
              effective_status,
              creative: { id: '456' },
            });
          },
        },
      );
      expect(
        await planNextMarketingJob(sql, native.profiles, Date.parse('2026-09-10T00:00:00Z'), 1),
      ).toEqual({ planned: 1 });
      expect(
        await planNextMarketingJob(sql, native.profiles, Date.parse('2026-09-10T00:00:00Z'), 1),
      ).toEqual({ planned: 0 });
      expect(await runMarketingSyncCycle(sql, native, async () => {}, signal(), 1)).toMatchObject({
        state: 'complete',
        planned: 0,
        attempted: 1,
        published: 1,
        retry: 0,
      });
      expect(await runMarketingSyncCycle(sql, native, async () => {}, signal(), 1)).toMatchObject({
        attempted: 0,
        planned: 0,
      });
      expect(calls.filter((x) => x.endsWith('/insights'))).toHaveLength(1);
      const [row] =
        await sql`select g.report from portal_marketing.report_windows w join portal_marketing.report_generations g on g.id=w.current_generation where w.job_id=${jobId}`;
      expect(row.report.metrics.find((m: { key: string }) => m.key === 'spend').value).toBe(
        '99.99',
      );
      expect(createConfiguredMarketingProviders(sql, {}, async () => {}).profiles).toEqual([]);
    },
  );
});
