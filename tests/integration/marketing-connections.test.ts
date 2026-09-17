import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createMarketingConnections } from '@/server/modules/marketing-ads/connections';
import { createFacebookAccountVerifier } from '@/server/modules/marketing-ads/facebook/verify-account';
import { createFacebookQuota } from '@/server/modules/marketing-ads/facebook/quota';
import { createMarketingConnectionsHttp } from '@/server/http/marketing-connections';
import type { FacebookProfile } from '@/server/modules/marketing-ads/facebook/config';
const signal = () => new AbortController().signal;
beforeEach(async () => {
  await sql`delete from portal_marketing.request_limits`;
});
async function fixture(onFetch?: () => Promise<void>, metadata = {}) {
  const f = await setup();
  const profile: FacebookProfile = {
    id: randomUUID(),
    namespace: randomUUID(),
    accountId: '123456',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    acquisitionOwner: 'portal-direct',
    tokenEnv: 'LABSD_FB_TEST_TOKEN',
  };
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label) values(${profile.id},${profile.namespace},'facebook','facebook.ad_insights',${profile.accountId},'Synthetic account')`;
  await sql`insert into portal_marketing.connection_grants values(${profile.id},${f.staff.id})`;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).toBe('GET');
    expect(new URL(String(input)).pathname).toBe('/v25.0/act_123456');
    await onFetch?.();
    return Response.json({
      id: 'act_123456',
      account_id: '123456',
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
      ...metadata,
    });
  });
  const verifier = createFacebookAccountVerifier(
    sql,
    {
      LABSD_FACEBOOK_READ_ENABLED: '1',
      LABSD_FACEBOOK_PROFILES: JSON.stringify([profile]),
      LABSD_FB_TEST_TOKEN: 'synthetic-only',
    },
    async () => {},
    { fetch: fetcher },
  );
  const service = createMarketingConnections(access, verifier),
    scope = { actorId: f.staff.id, permissionRevision: '1' };
  const command = async (action: 'verify' | 'pause' | 'retry', extras = {}) => {
    const [row] =
      await sql`select revision::text from portal_marketing.connections where id=${profile.id}`;
    return {
      ...scope,
      connectionId: profile.id,
      revision: row.revision,
      action,
      idempotencyKey: randomUUID(),
      ...extras,
    };
  };
  return { ...f, profile, verifier, service, scope, command, fetcher };
}
describe('staff connection lifecycle', () => {
  it('verifies a paused account with metadata only, enables it and replays without another source request', async () => {
    const f = await fixture(),
      cmd = await f.command('verify');
    await expect(
      createFacebookQuota(sql, [f.profile], async () => {}).beforeRequest(f.profile.id, signal()),
    ).rejects.toMatchObject({ code: 'access' });
    const result = await f.service.command(f.staff.headers, cmd, signal());
    expect(result).toMatchObject({ enabled: true, replayed: false });
    expect(await f.service.command(f.staff.headers, cmd, signal())).toEqual({
      ...result,
      replayed: true,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    const data = await f.service.read(f.staff.headers, f.scope);
    expect(data.connections[0]).toMatchObject({ configured: true, enabled: true, jobs: 0 });
    expect(JSON.stringify(data)).not.toMatch(/TOKEN|synthetic-only|namespace/);
    await f.service.command(f.staff.headers, await f.command('pause'), signal());
    await expect(
      createFacebookQuota(sql, [f.profile], async () => {}).beforeRequest(f.profile.id, signal()),
    ).rejects.toMatchObject({ code: 'access' });
    const [audit] =
      await sql`select count(*)::int as n from portal_marketing.connection_commands where connection_id=${f.profile.id}`;
    expect(audit.n).toBe(2);
    await expect(
      sql`delete from portal_marketing.connection_commands where connection_id=${f.profile.id}`,
    ).rejects.toThrow();
  });
  it.each([{ account_id: '999' }, { currency: 'USD' }, { timezone_name: 'UTC' }])(
    'refuses mismatched metadata %j without enabling',
    async (meta) => {
      const f = await fixture(undefined, meta);
      await expect(
        f.service.command(f.staff.headers, await f.command('verify'), signal()),
      ).rejects.toMatchObject({ code: 'invalid-source' });
      expect((await f.service.read(f.staff.headers, f.scope)).connections[0].enabled).toBe(false);
    },
  );
  it('rechecks grants after source I/O and leaves no successful command audit on revocation', async () => {
    let revoke: () => Promise<void> = async () => {};
    const f = await fixture(() => revoke());
    revoke = async () => {
      await sql`delete from portal_marketing.connection_grants where connection_id=${f.profile.id}`;
    };
    await expect(
      f.service.command(f.staff.headers, await f.command('verify'), signal()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await f.service.read(f.staff.headers, f.scope)).connections).toEqual([]);
    const [row] =
      await sql`select enabled,(select count(*)::int from portal_marketing.connection_commands where connection_id=${f.profile.id}) as n from portal_marketing.connections where id=${f.profile.id}`;
    expect(row).toMatchObject({ enabled: false, n: 0 });
  });
  it('allows pausing with invalid source config, denies stale revisions, alien scope and changed replay payload', async () => {
    const f = await fixture();
    const cmd = await f.command('verify');
    await f.service.command(f.staff.headers, cmd, signal());
    await expect(
      f.service.command(f.staff.headers, { ...cmd, action: 'pause' }, signal()),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      f.service.command(
        f.staff.headers,
        { ...(await f.command('pause')), revision: '1' },
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(f.service.read(f.viewer.headers, f.scope)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      f.service.read(f.staff.headers, { ...f.scope, actorId: f.viewer.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const service = createMarketingConnections(
      access,
      createFacebookAccountVerifier(
        sql,
        { LABSD_FACEBOOK_READ_ENABLED: '1', LABSD_FACEBOOK_PROFILES: 'invalid-json' },
        async () => {},
      ),
    );
    expect((await service.read(f.staff.headers, f.scope)).connections[0].configured).toBe(false);
    expect(
      await service.command(f.staff.headers, await f.command('pause'), signal()),
    ).toMatchObject({ enabled: false });
    await expect(
      service.command(f.staff.headers, await f.command('verify'), signal()),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('applies same-origin HTTP checks, authentication and safe response errors', async () => {
    const f = await fixture(undefined, { currency: 'USD' }),
      http = createMarketingConnectionsHttp(f.service, config.BETTER_AUTH_URL);
    const url = config.BETTER_AUTH_URL + '/api/v1/staff/ads/connections';
    const read = await http(
      new Request(url + '?' + new URLSearchParams(f.scope), { headers: f.staff.headers }),
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    expect((await http(new Request(url + '?' + new URLSearchParams(f.scope)))).status).toBe(401);
    expect(
      (
        await http(
          new Request(url + '?' + new URLSearchParams(f.scope) + '&actorId=x', {
            headers: f.staff.headers,
          }),
        )
      ).status,
    ).toBe(400);
    const headers = new Headers(f.staff.headers);
    headers.set('content-type', 'application/json');
    const body = JSON.stringify(await f.command('verify'));
    expect((await http(new Request(url, { method: 'POST', headers, body }))).status).toBe(403);
    headers.set('origin', config.BETTER_AUTH_URL);
    const response = await http(new Request(url, { method: 'POST', headers, body }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'invalid-source' });
  });
  it('requeues only failed windows, preserving a running lease, prior report and cooldown', async () => {
    const f = await fixture();
    await f.catalogue();
    await f.service.command(f.staff.headers, await f.command('verify'), signal());
    const target = randomUUID(),
      association = randomUUID(),
      job = randomUUID();
    await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref) values(${target},${f.partnerId},'clip-1','mock','Mock','Mock only')`;
    await sql`insert into portal_marketing.associations(id,target_id,partner_id,clip_id,agreement_id,connection_id,namespace,account_id,platform,object_type,external_id,source_identity,creative_ids,name,created_by) values(${association},${target},${f.partnerId},'clip-1','mock',${f.profile.id},${f.profile.namespace},${f.profile.accountId},'facebook','ad','789','{}','["456"]','Synthetic',${f.staff.id})`;
    await sql`insert into portal_marketing.sync_jobs(id,association_id,mapping_revision,state,attempt,issue) values(${job},${association},1,'needs-attention',8,'temporary')`;
    const failed = randomUUID(),
      running = randomUUID(),
      generation = randomUUID(),
      lease = randomUUID();
    for (const [id, day] of [
      [failed, '2026-09-01'],
      [running, '2026-09-02'],
    ]) {
      await sql`insert into portal_marketing.report_windows(id,job_id,period_from,period_to,timezone,definition,definition_hash,state,attempt,issue) values(${id},${job},${day}::timestamptz,${day}::timestamptz+interval '1 day','Asia/Bangkok','{}',${'a'.repeat(64)},'needs-attention',8,'temporary')`;
    }
    await sql`update portal_marketing.report_windows set state='running',lease_token=${lease},lease_until=clock_timestamp()+interval '1 minute' where id=${running}`;
    await sql`insert into portal_marketing.report_generations(id,window_id,report,report_sha256) values(${generation},${failed},'{}',${'b'.repeat(64)})`;
    await sql`update portal_marketing.report_windows set current_generation=${generation} where id=${failed}`;
    await createFacebookQuota(sql, [f.profile], async () => {}).recordUsage(f.profile.id, {
      percent: 95,
      retryAfterMs: 600000,
    });
    const [financeBefore] =
      await sql`select earnings,settlements from portal_meta.partner_changes where partner_id=${f.partnerId}`;
    const cmd = await f.command('retry');
    await f.service.command(f.staff.headers, cmd, signal());
    const rows =
      await sql`select id,state,attempt,issue,lease_token,current_generation from portal_marketing.report_windows where job_id=${job}`;
    expect(rows.find((r) => r.id === failed)).toMatchObject({
      state: 'queued',
      attempt: 0,
      issue: null,
      current_generation: generation,
    });
    expect(rows.find((r) => r.id === running)).toMatchObject({
      state: 'running',
      lease_token: lease,
      attempt: 8,
    });
    await expect(
      createFacebookQuota(sql, [f.profile], async () => {}).beforeRequest(f.profile.id, signal()),
    ).rejects.toMatchObject({ code: 'throttled' });
    expect(await f.service.command(f.staff.headers, cmd, signal())).toMatchObject({
      replayed: true,
    });
    const [financeAfter] =
      await sql`select earnings,settlements from portal_meta.partner_changes where partner_id=${f.partnerId}`;
    expect(financeAfter).toEqual(financeBefore);
  });
});
