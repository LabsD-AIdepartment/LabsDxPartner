import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access } from '../helpers/partner-finance';
import { createImportActivityReader } from '@/server/modules/marketing-ads/import-activity';
import { createImportActivityHttp } from '@/server/http/import-activity';
import { createMarketingConnections } from '@/server/modules/marketing-ads/connections';
import { createShopVideoConnections } from '@/server/modules/marketing-ads/tiktok-shop/video-connections';
async function fixture(platform: 'facebook' | 'tiktok') {
  const f = await setup();
  const id = randomUUID(),
    scope = { actorId: f.staff.id, permissionRevision: '1', platform };
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
    values(${id},'activity-test',${platform},${platform === 'facebook' ? 'facebook.ad_insights' : 'tiktok.shop_video'},${id},'Synthetic queue',true,clock_timestamp())`;
  await sql`insert into portal_marketing.connection_grants values(${id},${f.staff.id})`;
  let jobId = randomUUID(),
    targetId = randomUUID();
  if (platform === 'facebook') {
    await f.catalogue();
    await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref) values(${targetId},${f.partnerId},'clip-1','synthetic','Synthetic','synthetic')`;
    const a = randomUUID();
    await sql`insert into portal_marketing.associations(id,target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,external_id,source_identity,creative_ids,name,created_by)
      values(${a},${targetId},${f.partnerId},'clip-1','synthetic',${id},'activity-test',${id},'facebook','ad','123','{}','[]','Synthetic',${f.staff.id})`;
    await sql`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision,refresh_from,plan_as_of) values(${jobId},${a},1,'2026-08-01',clock_timestamp())`;
  } else {
    await sql`insert into portal_marketing.video_schedules(connection_id,period_from,period_to,timezone,connection_revision,profile_hash,plan_as_of)
      values(${id},'2026-08-01','2026-09-01','Asia/Bangkok',1,${'a'.repeat(64)},clock_timestamp())`;
  }
  async function window(
    day: number,
    kind: 'waiting' | 'running' | 'scheduled' | 'attention' | 'expired' = 'waiting',
  ) {
    const windowId = randomUUID(),
      from = `2026-08-${String(day).padStart(2, '0')}`,
      to = `2026-08-${String(day + 1).padStart(2, '0')}`;
    const state =
      kind === 'attention'
        ? 'needs-attention'
        : kind === 'expired' || kind === 'running'
          ? 'running'
          : 'queued';
    const lease = kind === 'expired' || kind === 'running' ? randomUUID() : null;
    const leaseUntil = lease
      ? new Date(Date.now() + (kind === 'expired' ? -60000 : 60000)).toISOString()
      : null;
    const next = new Date(Date.now() + (kind === 'scheduled' ? 3600000 : -600000)).toISOString();
    if (platform === 'facebook')
      await sql`insert into portal_marketing.report_windows(id,job_id,period_from,period_to,timezone,definition,definition_hash,state,next_run_at,lease_token,lease_until)
      values(${windowId},${jobId},${from},${to},'Asia/Bangkok','{}',${'b'.repeat(64)},${state},${next},${lease},${leaseUntil})`;
    else
      await sql`insert into portal_marketing.video_windows(id,connection_id,period_from,period_to,timezone,connection_revision,state,next_attempt_at,retry_paused,issue,lease_token,lease_until)
      values(${windowId},${id},${from},${to},'Asia/Bangkok',1,${state},${next},${kind === 'attention'},${kind === 'attention' ? 'temporary' : null},${lease},${leaseUntil})`;
    return windowId;
  }
  const read = () => createImportActivityReader(access)(f.staff.headers, scope);
  return { ...f, id, scope, jobId, targetId, window, read };
}
const connectionScope = (f: Awaited<ReturnType<typeof fixture>>) => ({
  actorId: f.scope.actorId,
  permissionRevision: f.scope.permissionRevision,
});
const retryCommand = (f: Awaited<ReturnType<typeof fixture>>) => ({
  ...connectionScope(f),
  action: 'retry',
  connectionId: f.id,
  revision: '1',
  idempotencyKey: randomUUID(),
});
describe('authorized persisted import queue', () => {
  it.each(['facebook', 'tiktok'] as const)(
    '%s coverage keeps old and missing reports visible despite a recent success or backoff',
    async (platform) => {
      const f = await fixture(platform);
      const old = await f.window(1, 'attention');
      const recent = await f.window(2, 'scheduled');
      await f.window(3, 'running');
      for (const [id, age] of [
        [old, 7200],
        [recent, 60],
      ] as const) {
        const generation = randomUUID();
        if (platform === 'facebook') {
          await sql`insert into portal_marketing.report_generations(id,window_id,report,report_sha256)
            values(${generation},${id},'{}',${'c'.repeat(64)})`;
          await sql`update portal_marketing.report_windows set current_generation=${generation},
            last_success_at=clock_timestamp()-${age}*interval '1 second',refresh_seconds=3600 where id=${id}`;
        } else {
          await sql`insert into portal_marketing.video_generations(id,window_id,lease_token,connection_revision,report_hash,metadata)
            values(${generation},${id},${randomUUID()},1,${'c'.repeat(64)},'{}')`;
          await sql`update portal_marketing.video_windows set current_generation=${generation},
            last_success_at=clock_timestamp()-${age}*interval '1 second',refresh_seconds=3600 where id=${id}`;
        }
      }
      const before = (await f.read()).connections[0].freshness!;
      expect(before).toMatchObject({ imported: 2, missing: 1, refreshDue: 1 });
      expect(Date.parse(before.oldestSuccessAt!)).toBeLessThan(Date.parse(before.latestSuccessAt!));
      expect(Date.parse(before.oldestRefreshDueAt!) - Date.parse(before.oldestSuccessAt!)).toBe(
        3600000,
      );
      await sql`insert into portal_marketing.connection_runtime(connection_id,blocked_until)
        values(${f.id},clock_timestamp()+interval '4 hours')`;
      // Failure scheduling must not reset source freshness or hide retained reports.
      if (platform === 'facebook')
        await sql`update portal_marketing.report_windows set next_run_at=clock_timestamp()+interval '3 hours' where id=${old}`;
      else
        await sql`update portal_marketing.video_windows set next_attempt_at=clock_timestamp()+interval '3 hours' where id=${old}`;
      expect((await f.read()).connections[0].freshness).toEqual(before);
      if (platform === 'facebook')
        await sql`update portal_marketing.sync_jobs set refresh_from='2026-08-02' where id=${f.jobId}`;
      else
        await sql`update portal_marketing.video_schedules set period_from='2026-08-02' where connection_id=${f.id}`;
      const current = (await f.read()).connections[0].freshness!;
      expect(current).toMatchObject({
        imported: 1,
        missing: 1,
        refreshDue: 0,
        oldestRefreshDueAt: null,
      });
      expect(current.oldestSuccessAt).toBe(before.latestSuccessAt);
      if (platform === 'tiktok') {
        // Replanning advances window revision but deliberately retains old generations.
        await sql`update portal_marketing.connections set revision=2 where id=${f.id}`;
        await sql`update portal_marketing.video_schedules set connection_revision=2 where connection_id=${f.id}`;
        await sql`update portal_marketing.video_windows set connection_revision=2 where connection_id=${f.id}`;
        expect((await f.read()).connections[0].freshness).toEqual({
          imported: 0,
          missing: 2,
          refreshDue: 0,
          oldestSuccessAt: null,
          latestSuccessAt: null,
          oldestRefreshDueAt: null,
        });
        const [retained] =
          await sql`select current_generation from portal_marketing.video_windows where id=${recent}`;
        expect(retained.current_generation).not.toBeNull();
        const replacement = randomUUID();
        await sql`insert into portal_marketing.video_generations(id,window_id,lease_token,connection_revision,report_hash,metadata)
          values(${replacement},${recent},${randomUUID()},2,${'d'.repeat(64)},'{}')`;
        await sql`update portal_marketing.video_windows set current_generation=${replacement},last_success_at=clock_timestamp() where id=${recent}`;
        expect((await f.read()).connections[0].freshness).toMatchObject({
          imported: 1,
          missing: 1,
          refreshDue: 0,
        });
        const [history] =
          await sql`select count(*)::int as n from portal_marketing.video_generations where window_id=${recent}`;
        expect(history.n).toBe(2);
      }
      await sql`delete from portal_marketing.connection_grants where connection_id=${f.id}`;
      expect((await f.read()).connections).toEqual([]);
    },
  );

  it.each(['target', 'partner', 'clip'] as const)(
    'Facebook account totals exclude inactive %s work without deleting its history',
    async (inactive) => {
      const f = await fixture('facebook');
      const inactiveWindow = await f.window(1, 'attention');
      await sql`update portal_marketing.sync_jobs set state='needs-attention',last_success_at='2026-08-20T00:00:00Z' where id=${f.jobId}`;
      const service = createMarketingConnections(access, {
        configured: () => undefined,
        verify: async () => {
          throw Error('GET must not verify source');
        },
      });
      const read = async () =>
        (await service.read(f.staff.headers, connectionScope(f))).connections[0];
      expect(await read()).toMatchObject({
        jobs: 1,
        attention: 1,
        lastSuccessAt: '2026-08-20T00:00:00.000Z',
      });
      if (inactive === 'target')
        await sql`update portal_marketing.targets set active=false where id=${f.targetId}`;
      if (inactive === 'partner')
        await sql`update portal_access.partners set status='suspended' where id=${f.partnerId}`;
      if (inactive === 'clip')
        await sql`update portal_content.clips set removed=true where partner_id=${f.partnerId} and id='clip-1'`;
      expect(await read()).toMatchObject({ jobs: 0, attention: 0, lastSuccessAt: null });
      expect((await f.read()).connections[0].reports).toBe(0);
      await service.command(f.staff.headers, retryCommand(f), new AbortController().signal);
      const [stored] =
        await sql`select state,last_success_at from portal_marketing.sync_jobs where id=${f.jobId}`;
      expect(stored.state).toBe('needs-attention');
      const [preservedWindow] =
        await sql`select state from portal_marketing.report_windows where id=${inactiveWindow}`;
      expect(preservedWindow.state).toBe('needs-attention');
      expect(new Date(stored.last_success_at).toISOString()).toBe('2026-08-20T00:00:00.000Z');
    },
  );

  it('Facebook account totals count only the current mapping job', async () => {
    const f = await fixture('facebook');
    await sql`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision,state,last_success_at)
      select ${randomUUID()},association_id,0,'needs-attention','2026-08-30T00:00:00Z' from portal_marketing.sync_jobs where id=${f.jobId}`;
    const service = createMarketingConnections(access, {
      configured: () => undefined,
      verify: async () => {
        throw Error('GET must not verify source');
      },
    });
    expect((await service.read(f.staff.headers, connectionScope(f))).connections[0]).toMatchObject({
      jobs: 1,
      attention: 0,
      lastSuccessAt: null,
    });
    await service.command(f.staff.headers, retryCommand(f), new AbortController().signal);
    const [old] = await sql`select state from portal_marketing.sync_jobs where mapping_revision=0
      and association_id=(select association_id from portal_marketing.sync_jobs where id=${f.jobId})`;
    expect(old.state).toBe('needs-attention');
  });

  it('TikTok account totals exclude legacy multi-day windows while retaining current daily failures', async () => {
    const f = await fixture('tiktok');
    const current = await f.window(1, 'attention');
    await f.window(2);
    await sql`update portal_marketing.video_windows set last_success_at='2026-08-20T00:00:00Z' where id=${current}`;
    const legacy = randomUUID();
    await sql`insert into portal_marketing.video_windows(id,connection_id,period_from,period_to,timezone,connection_revision,state,retry_paused,issue,last_success_at)
      values(${legacy},${f.id},'2026-08-01','2026-08-08','Asia/Bangkok',1,'needs-attention',true,'temporary','2026-08-30T00:00:00Z')`;
    const service = createShopVideoConnections(access, null);
    expect((await service.read(f.staff.headers, connectionScope(f))).connections[0]).toMatchObject({
      jobs: 2,
      attention: 1,
      retryable: 1,
      lastSuccessAt: '2026-08-20T00:00:00.000Z',
    });
    expect((await f.read()).connections[0]).toMatchObject({ reports: 2, attention: 1 });
    await service.command(f.staff.headers, retryCommand(f), new AbortController().signal);
    const [stored] = await sql`select state from portal_marketing.video_windows where id=${legacy}`;
    expect(stored.state).toBe('needs-attention');
    const [retried] =
      await sql`select state from portal_marketing.video_windows where id=${current}`;
    expect(retried.state).toBe('queued');
    await sql`update portal_marketing.video_windows set state='needs-attention',issue='temporary' where id=${current}`;
    await sql`update portal_marketing.video_schedules set connection_revision=2 where connection_id=${f.id}`;
    expect((await service.read(f.staff.headers, connectionScope(f))).connections[0].jobs).toBe(0);
    await service.command(f.staff.headers, retryCommand(f), new AbortController().signal);
    const [obsolete] =
      await sql`select state from portal_marketing.video_windows where id=${current}`;
    expect(obsolete.state).toBe('needs-attention');
    await sql`delete from portal_marketing.connection_grants where connection_id=${f.id}`;
    expect((await service.read(f.staff.headers, connectionScope(f))).connections).toEqual([]);
  });
  it.each(['facebook', 'tiktok'] as const)(
    'separates active/expired leases, backoff and holds for %s',
    async (platform) => {
      const f = await fixture(platform);
      await f.window(1);
      await f.window(2, 'running');
      await f.window(3, 'scheduled');
      await f.window(4, 'attention');
      await f.window(5, 'expired');
      const data = await f.read();
      expect(data.connections).toHaveLength(1);
      expect(data.connections[0]).toMatchObject({
        connectionId: f.id,
        revision: '1',
        paused: false,
        reports: 5,
        running: 1,
        waiting: 2,
        scheduled: 1,
        attention: 1,
      });
      expect(Date.parse(data.connections[0].oldestWaitingAt!)).toBeLessThan(
        Date.parse(data.evaluatedAt) - 180000,
      );
      expect(Date.parse(data.connections[0].nextAttemptAt!)).toBeGreaterThan(
        Date.parse(data.evaluatedAt),
      );
      const payload = JSON.stringify(data);
      expect(payload).not.toMatch(/lease_token|namespace|account_id|profile_hash|activity-test/);
      await sql`insert into portal_marketing.connection_runtime(connection_id,blocked_until) values(${f.id},clock_timestamp()+interval '2 hours')`;
      const blocked = (await f.read()).connections[0];
      expect(blocked).toMatchObject({
        waiting: 0,
        scheduled: 3,
        running: 1,
        attention: 1,
        oldestWaitingAt: null,
      });
      await sql`update portal_marketing.connections set enabled=false where id=${f.id}`;
      expect((await f.read()).connections[0]).toMatchObject({ paused: true, revision: '2' });
    },
  );
  it('excludes retired Facebook windows and inactive targets; respects per-account quota', async () => {
    const f = await fixture('facebook');
    await f.window(1);
    await sql`insert into portal_marketing.request_limits(bucket,blocked_until) values(${'facebook:connection:' + f.id},clock_timestamp()+interval '1 hour')`;
    expect((await f.read()).connections[0]).toMatchObject({ waiting: 0, scheduled: 1 });
    await sql`update portal_marketing.sync_jobs set refresh_from='2026-08-03' where id=${f.jobId}`;
    expect((await f.read()).connections[0].reports).toBe(0);
    await f.window(5);
    await sql`update portal_marketing.targets set active=false where id=${f.targetId}`;
    expect((await f.read()).connections[0].reports).toBe(0);
  });
  it('excludes obsolete TikTok schedules and propagates account access holds across planned periods', async () => {
    const f = await fixture('tiktok');
    const held = await f.window(1, 'attention');
    await f.window(2);
    await sql`update portal_marketing.video_windows set issue='access' where id=${held}`;
    expect((await f.read()).connections[0]).toMatchObject({ reports: 2, attention: 2, waiting: 0 });
    await sql`update portal_marketing.video_schedules set period_from='2026-08-02' where connection_id=${f.id}`;
    expect((await f.read()).connections[0]).toMatchObject({ reports: 1, attention: 1 });
    await sql`update portal_marketing.video_schedules set connection_revision=2 where connection_id=${f.id}`;
    expect((await f.read()).connections[0].reports).toBe(0);
  });
  it('uses actor/revision/account grants and keeps HTTP private, read-only and lane-gated', async () => {
    const f = await fixture('facebook');
    await f.window(1);
    const http = createImportActivityHttp(access, ['facebook']);
    const req = (scope: Record<string, string>, headers = f.staff.headers) =>
      new Request(
        'https://partner.example.test/api/v1/staff/import-activity?' + new URLSearchParams(scope),
        { headers },
      );
    const good = await http(req(f.scope));
    expect(good.status).toBe(200);
    expect(good.headers.get('cache-control')).toBe('private, no-store');
    expect((await http(req(f.scope, new Headers()))).status).toBe(401);
    expect((await http(req({ ...f.scope, actorId: f.viewer.id }))).status).toBe(403);
    expect((await http(req({ ...f.scope, permissionRevision: '2' }))).status).toBe(403);
    expect((await http(req({ ...f.scope, platform: 'tiktok' }))).status).toBe(404);
    expect(
      (
        await http(
          new Request('https://partner.example.test/api/v1/staff/import-activity', {
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(405);
    await sql`delete from portal_marketing.connection_grants where connection_id=${f.id}`;
    expect((await f.read()).connections).toEqual([]);
  });
});
