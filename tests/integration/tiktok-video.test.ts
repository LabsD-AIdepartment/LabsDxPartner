import { createShopVideoVerifier } from '@/server/modules/marketing-ads/tiktok-shop/video-verifier';
import { createShopVideoLifecycle } from '@/server/modules/marketing-ads/tiktok-shop/video-lifecycle';
import {
  createShopVideoTransport,
  AUTHORIZED_SHOPS_PATH,
} from '@/server/modules/marketing-ads/tiktok-shop/video-transport';
import { describe, it, expect, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '@/server/modules/identity/credential-auth';
import { createShopVideoOwnerHandler } from '@/server/modules/marketing-ads/tiktok-shop/owner-handler';
import { createConfiguredShopVideoWorker } from '@/server/modules/marketing-ads/tiktok-shop/video-composition';
import { createShopVideoConnections } from '@/server/modules/marketing-ads/tiktok-shop/video-connections';
import { createMarketingConnectionsHttp } from '@/server/http/marketing-connections';
import type { TransactionSql } from 'postgres';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createShopVideoStore } from '@/server/modules/marketing-ads/tiktok-shop/video-store';
import { createShopVideoCollector } from '@/server/modules/marketing-ads/tiktok-shop/video-collector';
import { collectAndPublishShopVideos } from '@/server/modules/marketing-ads/tiktok-shop/video-cycle';
import { createShopVideoRegistration } from '@/server/modules/marketing-ads/tiktok-shop/video-registration';
import { createPartnerShopVideoRead } from '@/server/modules/marketing-ads/tiktok-shop/video-partner-read';
import { createMarketingConnections } from '@/server/modules/marketing-ads/connections';
import { createFacebookAccountVerifier } from '@/server/modules/marketing-ads/facebook/verify-account';
import { createMarketingRegistration } from '@/server/modules/marketing-ads/registration';
import { createShopVideoHttp } from '@/server/http/shop-videos';
import { SourceReadError } from '@/server/modules/marketing-ads/source-error';
import { runShopVideoTick } from '@/server/modules/marketing-ads/tiktok-shop/video-worker';
import { videoDailySchedule } from '@/server/modules/marketing-ads/tiktok-shop/video-schedule';

const period = { from: '2026-09-01', toExclusive: '2026-09-10' };
const abort = () => new AbortController().signal;
async function fixture() {
  const f = await setup();
  await f.catalogue();
  const profile = {
    connectionId: randomUUID(),
    namespace: randomUUID(),
    shopId: randomUUID(),
    currency: 'THB',
    timezone: 'Asia/Bangkok',
  };
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
    values(${profile.connectionId},${profile.namespace},'tiktok','tiktok.shop_video',${profile.shopId},'Synthetic TikTok shop',true,clock_timestamp())`;
  await sql`insert into portal_marketing.connection_grants(connection_id,user_id) values(${profile.connectionId},${f.staff.id})`;
  const targetId = randomUUID();
  await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
    values(${targetId},${f.partnerId},'clip-1','synthetic-deal','Synthetic deal','synthetic-reference')`;
  const binding = vi.fn(async (tx: TransactionSql) => {
    const [row] = await tx`select current_database() as name`;
    expect(row.name).toBe('labsd_partner_test');
  });
  const store = createShopVideoStore(sql, [profile], binding);
  const row = (id = 'video-one', creator = 'creator-one', amount = '9007199254740993.01') => ({
    id,
    title: 'Synthetic video',
    creator: {
      open_id: creator,
      user_name: 'sample',
      nick_name: 'Sample',
      author_type: 'AFFILIATE',
    },
    views: 12,
    sku_orders: 2,
    items_sold: 3,
    gmv: { amount, currency: 'THB' },
    click_through_rate: '0.05',
  });
  const source = vi.fn().mockImplementation(async () => ({
    code: 0,
    request_id: randomUUID(),
    data: {
      videos: [row(), row('unrelated-video', 'other-creator', '1')],
      total_count: 2,
      latest_available_date: '2026-09-09',
      next_page_token: '',
    },
  }));
  const collect = createShopVideoCollector([profile], { request: source });
  const registration = createShopVideoRegistration(access),
    read = createPartnerShopVideoRead(access);
  const actor = await access.staffSession(f.staff.headers);
  const query = {
    actorId: actor.userId,
    permissionRevision: actor.revision,
    targetId,
    connectionId: profile.connectionId,
    videoId: 'video-one',
  };
  const partnerQuery = {
    partnerId: f.partnerId,
    permissionRevision: 'p1:m1',
    clipId: 'clip-1',
    ...period,
  };
  async function publish() {
    return collectAndPublishShopVideos(store, collect, profile.connectionId, period, abort());
  }
  async function save() {
    const proof = await registration.lookup(f.staff.headers, query);
    const { title, creatorName, ...command } = proof;
    void title;
    void creatorName;
    return registration.save(f.staff.headers, { ...command, idempotencyKey: randomUUID() });
  }
  return {
    ...f,
    profile,
    targetId,
    store,
    row,
    source,
    collect,
    registration,
    read,
    query,
    partnerQuery,
    publish,
    save,
    binding,
  };
}
describe('native TikTok Shop video persistence and access', () => {
  it('retains last-good values after transport failure and does not shorten a long provider cooldown', async () => {
    const f = await fixture();
    await f.publish();
    await f.save();
    f.source.mockRejectedValueOnce(new SourceReadError('throttled', 10 * 86400000));
    await expect(f.publish()).rejects.toMatchObject({ code: 'throttled' });
    expect((await f.read(f.viewer.headers, f.partnerQuery)).items[0].performance).toMatchObject({
      state: 'stale',
      views: null,
    });
    const [r] =
      await sql`select blocked_until>clock_timestamp()+interval '9 days' as waiting from portal_marketing.connection_runtime where connection_id=${f.profile.connectionId}`;
    expect(r.waiting).toBe(true);
    expect(await f.store.claim(f.profile.connectionId, period)).toBeNull();
  });
  it('shows last-good data stale when a worker lease expires without reporting failure', async () => {
    const f = await fixture();
    await f.publish();
    await f.save();
    const lease = await f.store.claim(f.profile.connectionId, period);
    await sql`update portal_marketing.video_windows set lease_until=clock_timestamp()-interval '1 second' where id=${lease!.windowId}`;
    expect((await f.read(f.viewer.headers, f.partnerQuery)).items[0].performance).toMatchObject({
      state: 'stale',
      views: null,
    });
  });
  it('serves authenticated HTTP lookup/save/read with origin, input and cache controls', async () => {
    const f = await fixture();
    await f.publish();
    const origin = 'https://partner.example.test';
    const post = (body: unknown, headers = f.staff.headers) =>
      new Request(origin + '/api/v1/staff/shop-videos/lookup', {
        method: 'POST',
        headers: new Headers([
          ...headers,
          ['origin', origin],
          ['content-type', 'application/json'],
        ]),
        body: JSON.stringify(body),
      });
    const lookup = createShopVideoHttp(access, origin, 'lookup');
    const response = await lookup(post(f.query));
    expect(response.status).toBe(200);
    const { title, creatorName, ...proof } = await response.json();
    void title;
    void creatorName;
    const saved = await createShopVideoHttp(
      access,
      origin,
      'save',
    )(post({ ...proof, idempotencyKey: randomUUID() }));
    expect(saved.status).toBe(200);
    const read = createShopVideoHttp(access, origin, 'partner-read');
    const url =
      origin + '/api/v1/partner/content/shop-videos?' + new URLSearchParams(f.partnerQuery);
    const result = await read(new Request(url, { headers: f.viewer.headers }));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect((await result.json()).items).toHaveLength(1);
    expect((await read(new Request(url))).status).toBe(401);
    expect(
      (await read(new Request(url + '&clipId=other', { headers: f.viewer.headers }))).status,
    ).toBe(400);
    const wrong = post(f.query);
    wrong.headers.set('origin', 'https://other.invalid');
    expect((await lookup(wrong)).status).toBe(403);
    expect((await lookup(post({ ...f.query, shopId: 'injected' }))).status).toBe(400);
  });
  it('collects once per shop, persists exact observations, maps one video and only exposes that clip', async () => {
    const f = await fixture();
    const [before] =
      await sql`select metrics,earnings,settlements from portal_meta.partner_changes where partner_id=${f.partnerId}`;
    expect(await f.publish()).toMatchObject({ state: 'published', replayed: false });
    expect(f.source).toHaveBeenCalledTimes(1);
    const saved = await f.save();
    const response = await f.read(f.viewer.headers, f.partnerQuery);
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      id: saved.mappingId,
      performance: {
        state: 'ready',
        views: null,
        paidSkuOrders: '2',
        gmv: { amount: '9007199254740993.01', currency: 'THB' },
      },
    });
    const wire = JSON.stringify(response);
    for (const hidden of [
      f.profile.shopId,
      f.profile.namespace,
      'unrelated-video',
      'other-creator',
      'creator-one',
      'sourceRequestIds',
    ])
      expect(wire).not.toContain(hidden);
    expect((await f.read(f.viewer.headers, { ...f.partnerQuery, clipId: 'clip-2' })).items).toEqual(
      [],
    );
    const [revisions] =
      await sql`select earnings,settlements,metrics from portal_meta.partner_changes where partner_id=${f.partnerId}`;
    expect(BigInt(revisions.metrics)).toBe(BigInt(before.metrics) + 1n);
    expect(String(revisions.earnings)).toBe(String(before.earnings));
    expect(String(revisions.settlements)).toBe(String(before.settlements));
  });
  it('rejects duplicate source reassignment and rechecks grants even for replayed commands', async () => {
    const f = await fixture();
    await f.publish();
    const { title, creatorName, ...proof } = await f.registration.lookup(f.staff.headers, f.query);
    void title;
    void creatorName;
    const cmd = { ...proof, idempotencyKey: randomUUID() };
    const saved = await f.registration.save(f.staff.headers, cmd);
    expect(await f.registration.save(f.staff.headers, cmd)).toMatchObject({
      mappingId: saved.mappingId,
      replayed: true,
    });
    const second = randomUUID();
    await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
      values(${second},${f.partnerId},'clip-2','another','Another','synthetic')`;
    await expect(
      f.registration.save(f.staff.headers, {
        ...cmd,
        targetId: second,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await sql`delete from portal_marketing.connection_grants where connection_id=${f.profile.connectionId}`;
    await expect(f.registration.save(f.staff.headers, cmd)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(f.registration.lookup(f.staff.headers, f.query)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('never exposes data after membership revocation or to another partner identity', async () => {
    const f = await fixture();
    await f.publish();
    await f.save();
    await expect(
      f.read(f.viewer.headers, { ...f.partnerQuery, partnerId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await sql`update portal_access.memberships set status='suspended' where partner_id=${f.partnerId} and user_id=${f.viewer.id}`;
    await expect(f.read(f.viewer.headers, f.partnerQuery)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
  it('one account lease prevents overlapping scans; expired workers cannot publish over newer leases', async () => {
    const f = await fixture(),
      old = await f.store.claim(f.profile.connectionId, period);
    expect(old).not.toBeNull();
    expect(
      await f.store.claim(f.profile.connectionId, {
        from: '2026-08-01',
        toExclusive: '2026-08-02',
      }),
    ).toBeNull();
    const collection = await f.collect(f.profile.connectionId, period, abort());
    await sql`update portal_marketing.connection_runtime set lease_until=clock_timestamp()-interval '1 second' where connection_id=${f.profile.connectionId}`;
    await sql`update portal_marketing.video_windows set lease_until=clock_timestamp()-interval '1 second' where id=${old!.windowId}`;
    const current = await f.store.claim(f.profile.connectionId, period);
    expect(current).not.toBeNull();
    await expect(f.store.publish(old!, collection)).rejects.toMatchObject({ code: 'access' });
    expect(await f.store.publish(current!, collection)).toMatchObject({ replayed: false });
  });
  it('publishes once under concurrent replay and preserves immutable evidence', async () => {
    const f = await fixture(),
      lease = await f.store.claim(f.profile.connectionId, period);
    const collection = await f.collect(f.profile.connectionId, period, abort());
    const results = await Promise.all([
      f.store.publish(lease!, collection),
      f.store.publish(lease!, collection),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(results[0].generationId).toBe(results[1].generationId);
    await expect(
      f.store.publish(lease!, { ...collection, fetchedAt: '2026-09-01T00:00:00Z' }),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    await expect(
      sql`delete from portal_marketing.video_generations where id=${results[0].generationId}`,
    ).rejects.toThrow();
    await expect(
      sql`update portal_marketing.video_observations set creator_id='changed' where generation_id=${results[0].generationId}`,
    ).rejects.toThrow();
  });
  it('partial and failed acquisition keep last-good data marked stale and advance only metrics', async () => {
    const f = await fixture();
    await f.publish();
    await f.save();
    const before = await f.read(f.viewer.headers, f.partnerQuery);
    f.source.mockResolvedValueOnce({
      code: 0,
      request_id: 'late',
      data: {
        videos: [f.row()],
        total_count: 1,
        latest_available_date: '2026-09-08',
        next_page_token: '',
      },
    });
    expect(await f.publish()).toMatchObject({ state: 'partial' });
    const after = await f.read(f.viewer.headers, f.partnerQuery);
    expect(after.items[0].performance).toMatchObject({ state: 'stale', views: null });
    expect(BigInt(after.metricsRevision)).toBeGreaterThan(BigInt(before.metricsRevision));
    const [runtime] =
      await sql`select blocked_until>clock_timestamp() as blocked from portal_marketing.connection_runtime where connection_id=${f.profile.connectionId}`;
    expect(runtime.blocked).toBe(true);
  });
  it('creator changes and missing video observations never inherit the old mapping or become zero', async () => {
    const f = await fixture();
    await f.publish();
    await f.save();
    f.source.mockResolvedValueOnce({
      code: 0,
      request_id: 'changed',
      data: {
        videos: [f.row('video-one', 'changed-creator')],
        total_count: 1,
        latest_available_date: '2026-09-09',
        next_page_token: '',
      },
    });
    await f.publish();
    expect((await f.read(f.viewer.headers, f.partnerQuery)).items[0].performance).toMatchObject({
      state: 'partial',
      views: null,
      gmv: null,
    });
    f.source.mockResolvedValueOnce({
      code: 0,
      request_id: 'absent',
      data: {
        videos: [],
        total_count: 0,
        latest_available_date: '2026-09-09',
        next_page_token: '',
      },
    });
    await f.publish();
    await expect(f.registration.lookup(f.staff.headers, f.query)).rejects.toMatchObject({
      code: 'conflict',
    });
    expect((await f.read(f.viewer.headers, f.partnerQuery)).items[0].performance.views).toBeNull();
  });
  it('fences changed connection and target revisions and rejects swapped source proof', async () => {
    const f = await fixture();
    await f.publish();
    const { title, creatorName, ...proof } = await f.registration.lookup(f.staff.headers, f.query);
    void title;
    void creatorName;
    await expect(
      f.registration.save(f.staff.headers, {
        ...proof,
        creatorId: 'wrong',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await sql`update portal_marketing.targets set agreement_label='Edited' where id=${f.targetId}`;
    await expect(
      f.registration.save(f.staff.headers, { ...proof, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const lease = await f.store.claim(f.profile.connectionId, period),
      collection = await f.collect(f.profile.connectionId, period, abort());
    await sql`update portal_marketing.connections set enabled=false where id=${f.profile.connectionId}`;
    await expect(f.store.publish(lease!, collection)).rejects.toMatchObject({ code: 'access' });
  });
  it('preserves Facebook-only connection and registration readers after schema expansion', async () => {
    const f = await fixture();
    const verifier = createFacebookAccountVerifier(sql, {}, async () => {});
    const manager = createMarketingConnections(access, verifier);
    const scope = { actorId: f.query.actorId, permissionRevision: f.query.permissionRevision };
    expect((await manager.read(f.staff.headers, scope)).connections).toEqual([]);
    expect(
      (await createMarketingRegistration(access).read(f.staff.headers, scope)).connections,
    ).toEqual([]);
    await expect(sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label)
      values(${randomUUID()},'test','facebook','tiktok.shop_video','wrong','wrong')`).rejects.toThrow();
  });
});

describe('video UI option discovery', () => {
  it('lists only granted native video accounts, and readiness follows publication', async () => {
    const f = await fixture();
    const scope = {
      actorId: f.query.actorId,
      permissionRevision: f.query.permissionRevision,
      q: f.partnerId,
    };
    await sql`update portal_marketing.targets set agreement_label=${f.partnerId} where id=${f.targetId}`;
    const before = await f.registration.options(f.staff.headers, scope);
    expect(before.connections).toEqual([
      { id: f.profile.connectionId, label: 'Synthetic TikTok shop', available: false },
    ]);
    expect(before.targets).toEqual([
      expect.objectContaining({ id: f.targetId, partnerId: f.partnerId, clipId: 'clip-1' }),
    ]);
    await f.publish();
    const http = createShopVideoHttp(access, 'https://partner.example.test', 'options');
    const response = await http(
      new Request(
        'https://partner.example.test/api/v1/staff/shop-videos?' + new URLSearchParams(scope),
        { headers: f.staff.headers },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connections: [{ id: f.profile.connectionId, available: true }],
    });
    await sql`delete from portal_marketing.connection_grants where connection_id=${f.profile.connectionId}`;
    expect(await f.registration.options(f.staff.headers, scope)).toMatchObject({
      connections: [],
      targets: [],
    });
  });
  it('denies forged staff scope and partner credentials on discovery', async () => {
    const f = await fixture();
    const scope = { actorId: f.query.actorId, permissionRevision: f.query.permissionRevision };
    await expect(
      f.registration.options(f.staff.headers, { ...scope, actorId: 'other' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(f.registration.options(f.viewer.headers, scope)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('durable TikTok video schedule', () => {
  const at = Date.parse('2026-09-10T05:00:00Z');
  it('plans daily windows once, skips fresh reports, survives a new worker and excludes today', async () => {
    const f = await fixture();
    expect(await f.store.plan(f.profile.connectionId, at, { historyDays: 3 })).toMatchObject({
      planned: 3,
    });
    await f.store.plan(f.profile.connectionId, at + 1, { historyDays: 3 });
    const windows =
      await sql`select period_from::text,period_to::text from portal_marketing.video_windows where connection_id=${f.profile.connectionId}`;
    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.period_to <= '2026-09-10')).toBe(true);
    const lease = await f.store.claimDue(f.profile.connectionId);
    expect(lease?.period).toEqual({ from: '2026-09-09', toExclusive: '2026-09-10' });
    await f.store.publish(lease!, await f.collect(f.profile.connectionId, lease!.period, abort()));
    const restarted = createShopVideoStore(sql, [f.profile], f.binding);
    const next = await restarted.claimDue(f.profile.connectionId);
    expect(next?.period).toEqual({ from: '2026-09-08', toExclusive: '2026-09-09' });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
  });
  it('serializes competing workers and recovers expired leases without letting the old worker publish', async () => {
    const f = await fixture();
    await f.store.plan(f.profile.connectionId, at, { historyDays: 2 });
    const claims = await Promise.all([
      f.store.claimDue(f.profile.connectionId),
      f.store.claimDue(f.profile.connectionId),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find(Boolean)!;
    await sql`update portal_marketing.connection_runtime set lease_until=clock_timestamp()-interval '1 second' where connection_id=${f.profile.connectionId}`;
    await sql`update portal_marketing.video_windows set lease_until=clock_timestamp()-interval '1 second' where id=${old.windowId}`;
    const current = await f.store.claimDue(f.profile.connectionId);
    expect(current?.token).not.toBe(old.token);
    await expect(
      f.store.publish(old, await f.collect(f.profile.connectionId, old.period, abort())),
    ).rejects.toMatchObject({ code: 'access' });
    await f.store.publish(
      current!,
      await f.collect(f.profile.connectionId, current!.period, abort()),
    );
  });
  it('retains retry delays through replanning and resumes held work only after connection revision changes', async () => {
    const f = await fixture();
    await f.store.plan(f.profile.connectionId, at, { historyDays: 1 });
    const lease = await f.store.claimDue(f.profile.connectionId);
    await f.store.fail(lease!, 'temporary');
    await f.store.plan(f.profile.connectionId, at + 1, { historyDays: 1 });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
    const [retry] =
      await sql`select attempt_count,next_attempt_at>clock_timestamp()+interval '50 seconds' as waiting from portal_marketing.video_windows where id=${lease!.windowId}`;
    expect(retry).toMatchObject({ attempt_count: 1, waiting: true });
    await sql`update portal_marketing.video_windows set next_attempt_at=clock_timestamp()-interval '1 second' where id=${lease!.windowId}`;
    const second = await f.store.claimDue(f.profile.connectionId);
    await f.store.fail(second!, 'temporary');
    const [twice] =
      await sql`select attempt_count,next_attempt_at>clock_timestamp()+interval '110 seconds' as waiting from portal_marketing.video_windows where id=${lease!.windowId}`;
    expect(twice).toMatchObject({ attempt_count: 2, waiting: true });
    await sql`update portal_marketing.video_windows set next_attempt_at=clock_timestamp()-interval '1 second' where id=${lease!.windowId}`;
    await f.store.fail((await f.store.claimDue(f.profile.connectionId))!, 'access');
    await f.store.plan(f.profile.connectionId, at + 2, { historyDays: 1 });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
    await sql`update portal_marketing.connections set revision=revision+1 where id=${f.profile.connectionId}`;
    await f.store.plan(f.profile.connectionId, at + 3, { historyDays: 1 });
    expect(await f.store.claimDue(f.profile.connectionId)).not.toBeNull();
  });
  it('keeps provider cooldown across all windows and never resets it during replanning', async () => {
    const f = await fixture();
    await f.store.plan(f.profile.connectionId, at, { historyDays: 3 });
    await f.store.fail(
      (await f.store.claimDue(f.profile.connectionId))!,
      'throttled',
      10 * 86400000,
    );
    await f.store.plan(f.profile.connectionId, at + 1, { historyDays: 3 });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
    const [r] =
      await sql`select blocked_until>clock_timestamp()+interval '9 days' as waiting from portal_marketing.connection_runtime where connection_id=${f.profile.connectionId}`;
    expect(r.waiting).toBe(true);
  });
  it('rejects older plans and publication outside the new horizon without deleting old observations', async () => {
    const f = await fixture();
    await f.publish();
    await f.store.plan(f.profile.connectionId, at, { historyDays: 3 });
    const lease = await f.store.claimDue(f.profile.connectionId);
    // Move the active horizon beyond this lease; old acquisition remains retained only.
    await f.store.plan(f.profile.connectionId, at + 86400000, { historyDays: 1 });
    expect(await f.store.plan(f.profile.connectionId, at, { historyDays: 3 })).toEqual({
      planned: 0,
      superseded: true,
    });
    await expect(
      f.store.publish(lease!, await f.collect(f.profile.connectionId, lease!.period, abort())),
    ).rejects.toMatchObject({ code: 'access' });
    const [retained] =
      await sql`select count(*)::int as n from portal_marketing.video_generations g join portal_marketing.video_windows w on w.id=g.window_id where w.connection_id=${f.profile.connectionId}`;
    expect(retained.n).toBe(1);
  });
  it('does not let an older profile publish after a replacement worker has planned a different profile', async () => {
    const f = await fixture();
    await f.store.plan(f.profile.connectionId, at, { historyDays: 1 });
    const lease = await f.store.claimDue(f.profile.connectionId);
    const changed = createShopVideoStore(sql, [{ ...f.profile, currency: 'USD' }], f.binding);
    await changed.plan(f.profile.connectionId, at + 1, { historyDays: 1 });
    await expect(
      f.store.publish(lease!, await f.collect(f.profile.connectionId, lease!.period, abort())),
    ).rejects.toMatchObject({ code: 'access' });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
  });
});

describe('bounded native shop video worker', () => {
  function currentSource(f: Awaited<ReturnType<typeof fixture>>) {
    f.source.mockImplementation(async () => ({
      code: 0,
      request_id: randomUUID(),
      data: {
        videos: [f.row()],
        total_count: 1,
        next_page_token: '',
        latest_available_date: videoDailySchedule(f.profile.timezone, Date.now(), {
          historyDays: 1,
        }).from,
      },
    }));
  }
  it('runs the real collector/publication path and rotates shops across worker restarts', async () => {
    const a = await fixture(),
      b = await fixture();
    currentSource(a);
    currentSource(b);
    const profiles = [a.profile, b.profile];
    const collect = createShopVideoCollector(profiles, { request: a.source });
    const store = createShopVideoStore(sql, profiles, a.binding);
    const input = {
      connectionIds: profiles.map((p) => p.connectionId),
      maxJobs: 1,
      policy: { historyDays: 1 },
    };
    const first = await runShopVideoTick(store, collect, input, abort());
    expect(first.attempted).toBe(1);
    expect(first.results[0].state).toBe('published');
    const restarted = createShopVideoStore(sql, profiles, a.binding);
    const second = await runShopVideoTick(restarted, collect, input, abort());
    expect(second.attempted).toBe(1);
    expect(second.results[0].state).toBe('published');
    expect(second.results[0].connectionId).not.toBe(first.results[0].connectionId);
    const third = await runShopVideoTick(restarted, collect, input, abort());
    expect(third.attempted).toBe(0);
    expect(a.source).toHaveBeenCalledTimes(2);
  });
  it('isolates source failures per shop and reports only safe codes', async () => {
    const a = await fixture(),
      b = await fixture();
    currentSource(a);
    currentSource(b);
    const profiles = [a.profile, b.profile];
    const collect = createShopVideoCollector(profiles, {
      request: async (request, signal) => {
        if (request.connectionId === a.profile.connectionId)
          throw new Error('untrusted upstream secret');
        return b.source(request, signal);
      },
    });
    const result = await runShopVideoTick(
      createShopVideoStore(sql, profiles, a.binding),
      collect,
      {
        connectionIds: profiles.map((p) => p.connectionId),
        maxJobs: 2,
        policy: { historyDays: 1 },
      },
      abort(),
    );
    expect(result.attempted).toBe(2);
    expect(result.results).toEqual(
      expect.arrayContaining([
        { connectionId: a.profile.connectionId, state: 'attention', code: 'temporary' },
        { connectionId: b.profile.connectionId, state: 'published' },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('untrusted');
  });
  it('releases the acquired lease on cancellation without publishing partial work', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const collect = createShopVideoCollector([f.profile], {
      request: async () => {
        controller.abort();
        return f.source();
      },
    });
    const result = await runShopVideoTick(
      f.store,
      collect,
      { connectionIds: [f.profile.connectionId], policy: { historyDays: 1 } },
      controller.signal,
    );
    expect(result.stopped).toBe(true);
    const [state] =
      await sql`select state,lease_token,current_generation from portal_marketing.video_windows where connection_id=${f.profile.connectionId}`;
    expect(state).toMatchObject({
      state: 'needs-attention',
      lease_token: null,
      current_generation: null,
    });
  });
});

describe('shop-wide configuration holds', () => {
  it('holds other and newly planned days after access failure until a new connection revision', async () => {
    const f = await fixture();
    const at = Date.parse('2026-09-10T05:00:00Z');
    await f.store.plan(f.profile.connectionId, at, { historyDays: 2 });
    await f.store.fail((await f.store.claimDue(f.profile.connectionId))!, 'access');
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
    const differentProfile = createShopVideoStore(
      sql,
      [{ ...f.profile, currency: 'USD' }],
      f.binding,
    );
    await differentProfile.plan(f.profile.connectionId, at + 1, { historyDays: 2 });
    expect(await differentProfile.claimDue(f.profile.connectionId)).toBeNull();
    await f.store.plan(f.profile.connectionId, at + 86400000, { historyDays: 2 });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
    await sql`update portal_marketing.connections set revision=revision+1 where id=${f.profile.connectionId}`;
    await f.store.plan(f.profile.connectionId, at + 86400001, { historyDays: 2 });
    expect(await f.store.claimDue(f.profile.connectionId)).not.toBeNull();
  });
});

describe('scheduled partner freshness', () => {
  it('retains values but marks a missed scheduled refresh stale without a browser-triggered source request', async () => {
    const f = await fixture();
    await f.store.plan(f.profile.connectionId, Date.parse('2026-09-10T05:00:00Z'), {
      historyDays: 1,
    });
    const lease = (await f.store.claimDue(f.profile.connectionId))!;
    await f.store.publish(lease, await f.collect(f.profile.connectionId, lease.period, abort()));
    await f.save();
    const query = { ...f.partnerQuery, ...lease.period };
    expect((await f.read(f.viewer.headers, query)).items[0].performance.state).toBe('ready');
    await sql`update portal_marketing.video_windows set next_attempt_at=clock_timestamp()-interval '1 second' where id=${lease.windowId}`;
    expect((await f.read(f.viewer.headers, query)).items[0].performance).toMatchObject({
      state: 'stale',
      views: null,
    });
    expect(f.source).toHaveBeenCalledTimes(1);
  });
  it('does not label evidence from an earlier connection revision as current', async () => {
    const f = await fixture();
    await f.publish();
    await f.save();
    await sql`update portal_marketing.connections set revision=revision+1 where id=${f.profile.connectionId}`;
    expect((await f.read(f.viewer.headers, f.partnerQuery)).items[0].performance).toMatchObject({
      state: 'stale',
      views: null,
    });
  });
});

describe('native TikTok verification lifecycle', () => {
  it('serves granted current-horizon status over HTTP without source calls and pauses without owner configuration', async () => {
    const f = await fixture();
    const profile = {
      ...f.profile,
      acquisitionOwner: 'sale-dashboard' as const,
      sourceConnectionRef: 'owner-shop',
    };
    const verifier = { configured: () => profile, verify: vi.fn() };
    const service = createShopVideoConnections(access, verifier);
    const scope = { actorId: f.staff.id, permissionRevision: '1' };
    const origin = 'https://partner.example.test';
    const endpoint = origin + '/api/v1/staff/shop-videos/connections';
    const readRequest = (headers = f.staff.headers) =>
      new Request(endpoint + '?' + new URLSearchParams(scope), { headers });
    await f.store.plan(profile.connectionId, Date.now(), { historyDays: 2 });
    const http = createMarketingConnectionsHttp(service, origin);
    const response = await http(readRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const snapshot = await response.json();
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.connections[0]).toMatchObject({
      platform: 'tiktok',
      jobs: 2,
      attention: 0,
      configured: true,
    });
    expect(verifier.verify).not.toHaveBeenCalled();
    await sql`update portal_marketing.video_windows set state='needs-attention',issue='access',retry_paused=true
      where connection_id=${profile.connectionId}`;
    expect((await service.read(f.staff.headers, scope)).connections[0]).toMatchObject({
      attention: 2,
      retryable: 0,
    });
    await sql`update portal_marketing.video_windows set issue='temporary',retry_paused=false where connection_id=${profile.connectionId}`;
    expect((await service.read(f.staff.headers, scope)).connections[0]).toMatchObject({
      attention: 2,
      retryable: 2,
    });
    expect((await http(readRequest(new Headers()))).status).toBe(401);
    const outsider = await fixture();
    expect((await http(readRequest(outsider.staff.headers))).status).toBe(403);
    const withoutOwner = createMarketingConnectionsHttp(
      createShopVideoConnections(access, null),
      origin,
    );
    const post = (body: unknown, requestOrigin = origin) =>
      new Request(endpoint, {
        method: 'POST',
        headers: new Headers([
          ...f.staff.headers,
          ['origin', requestOrigin],
          ['content-type', 'application/json'],
        ]),
        body: JSON.stringify(body),
      });
    const command = {
      ...scope,
      connectionId: profile.connectionId,
      revision: snapshot.connections[0].revision,
      action: 'pause',
      idempotencyKey: randomUUID(),
    };
    expect((await withoutOwner(post(command, 'https://other.test'))).status).toBe(403);
    const paused = await withoutOwner(post(command));
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ enabled: false });
    const current = await (await withoutOwner(readRequest())).json();
    expect(current.connections[0]).toMatchObject({ enabled: false, configured: false, jobs: 0 });
    await sql`delete from portal_marketing.connection_grants where connection_id=${profile.connectionId}`;
    expect((await (await withoutOwner(readRequest())).json()).connections).toEqual([]);
    expect((await withoutOwner(post(command))).status).toBe(403);
  });
  it('runs the configured worker through real loopback HTTP, owner verification and native partner reads', async () => {
    const f = await fixture();
    const profile = {
      ...f.profile,
      acquisitionOwner: 'sale-dashboard' as const,
      sourceConnectionRef: 'synthetic-owner-shop',
    };
    await sql`update portal_marketing.connections set enabled=false,verified_at=null where id=${profile.connectionId}`;
    const serviceToken = 'synthetic-loopback-service-token-at-least-32-characters';
    const latest = videoDailySchedule(profile.timezone, Date.now(), { historyDays: 1 });
    const sourceFetch = vi.fn<typeof fetch>().mockImplementation(async (raw) =>
      Response.json(
        new URL(String(raw)).pathname === AUTHORIZED_SHOPS_PATH
          ? {
              code: 0,
              request_id: 'http-auth',
              data: { shops: [{ id: profile.shopId, cipher: 'synthetic-cipher', region: 'TH' }] },
            }
          : {
              code: 0,
              request_id: 'http-report',
              data: {
                videos: [f.row()],
                total_count: 1,
                latest_available_date: latest.from,
                next_page_token: '',
              },
            },
      ),
    );
    const handler = createShopVideoOwnerHandler(
      [profile],
      [
        {
          tokenSha256: createHash('sha256').update(serviceToken).digest('hex'),
          connectionIds: [profile.connectionId],
        },
      ],
      {
        credential: async () => ({
          shopId: profile.shopId,
          appKey: 'synthetic-key',
          appSecret: 'synthetic-secret',
          accessToken: 'synthetic-seller-token',
          shopCipher: 'synthetic-cipher',
        }),
        beforeRequest: async () => {},
        fetch: sourceFetch,
      },
    );
    // Test-only Node host. Production host must forward request disconnects to Request.signal.
    const server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4096) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (let i = 0; i < req.rawHeaders.length; i += 2)
          headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
        const response = await handler(
          new Request('http://127.0.0.1' + req.url, {
            method: req.method,
            headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        res.writeHead(500).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Loopback unavailable');
      const worker = createConfiguredShopVideoWorker(
        sql,
        {
          LABSD_MARKETING_ENABLED: '1',
          LABSD_TIKTOK_VIDEO_ENABLED: '1',
          LABSD_TIKTOK_VIDEO_SYNC_ENABLED: '1',
          LABSD_TIKTOK_VIDEO_PROFILES: JSON.stringify([profile]),
          LABSD_TIKTOK_OWNER_ORIGIN: `http://127.0.0.1:${address.port}`,
          LABSD_TIKTOK_OWNER_SERVICE_TOKEN: serviceToken,
        },
        f.binding,
      )!;
      // A configured endpoint never enables an unverified shop on its own.
      expect((await worker.run(abort())).results).toEqual([]);
      expect(sourceFetch).not.toHaveBeenCalled();
      const [c] =
        await sql`select revision::text from portal_marketing.connections where id=${profile.connectionId}`;
      const command = {
        actorId: f.staff.id,
        permissionRevision: '1',
        connectionId: profile.connectionId,
        revision: c.revision,
        action: 'verify',
        idempotencyKey: randomUUID(),
      };
      const lifecycle = createShopVideoLifecycle(access, worker.owner);
      const verified = await lifecycle(f.staff.headers, command, abort());
      expect(verified.enabled).toBe(true);
      expect(sourceFetch).toHaveBeenCalledTimes(2);
      expect((await worker.run(abort())).results).toMatchObject([{ state: 'published' }]);
      expect(sourceFetch).toHaveBeenCalledTimes(3);
      await f.save();
      const projection = await f.read(f.viewer.headers, {
        ...f.partnerQuery,
        from: latest.from,
        toExclusive: latest.toExclusive,
      });
      expect(projection.items[0].performance).toMatchObject({
        state: 'ready',
        views: null,
        gmv: { amount: '9007199254740993.01', currency: 'THB' },
      });
      expect(JSON.stringify(projection)).not.toContain('synthetic-seller-token');
      expect(JSON.stringify(projection)).not.toContain(profile.shopId);
      // Run the actual CLI supervisor + native child against this HTTP owner and isolated SQL.
      const [oldBinding] =
        await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
      await sql`insert into portal_identity.binding(id,namespace_digest) values(${CREDENTIAL_BINDING_ID},${credentialBindingDigest(config)})
        on conflict(id) do update set namespace_digest=excluded.namespace_digest`;
      const reserve = createServer();
      reserve.listen(0, '127.0.0.1');
      await once(reserve, 'listening');
      const healthAddress = reserve.address();
      if (!healthAddress || typeof healthAddress === 'string')
        throw new Error('Health address unavailable');
      await new Promise<void>((resolve) => reserve.close(() => resolve()));
      const host = spawn(process.execPath, ['scripts/marketing-worker.mjs', 'tiktok'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TMPDIR: resolve('.agent-work/runtime/tmp'),
          XDG_CACHE_HOME: resolve('.agent-work/runtime/cache'),
          DATABASE_URL: process.env.LABSD_TEST_DATABASE_URL,
          BETTER_AUTH_URL: config.BETTER_AUTH_URL,
          BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
          LABSD_MARKETING_ENABLED: '1',
          LABSD_TIKTOK_VIDEO_ENABLED: '1',
          LABSD_TIKTOK_VIDEO_SYNC_ENABLED: '1',
          LABSD_TIKTOK_VIDEO_PROFILES: JSON.stringify([profile]),
          LABSD_TIKTOK_OWNER_ORIGIN: `http://127.0.0.1:${address.port}`,
          LABSD_TIKTOK_OWNER_SERVICE_TOKEN: serviceToken,
          LABSD_WORKER_HEALTH_PORT: String(healthAddress.port),
        },
      });
      let output = '';
      host.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      host.stderr.resume();
      try {
        let healthy = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const response = await fetch(`http://127.0.0.1:${healthAddress.port}/health`, {
            signal: AbortSignal.timeout(500),
          }).catch(() => null);
          if (response?.status === 200) {
            expect(await response.json()).toMatchObject({
              state: 'running',
              platform: 'tiktok',
              starts: 1,
              attention: false,
            });
            healthy = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(healthy).toBe(true);
        expect(sourceFetch).toHaveBeenCalledTimes(4);
        expect(output).not.toContain(serviceToken);
        const exited = once(host, 'exit');
        host.kill('SIGTERM');
        await exited;
        expect(host.exitCode).toBe(0);
        expect(output).toContain('stopped');
      } finally {
        if (host.exitCode === null && host.signalCode === null) {
          const exited = once(host, 'exit');
          host.kill('SIGTERM');
          await exited;
        }
        if (oldBinding)
          await sql`update portal_identity.binding set namespace_digest=${oldBinding.namespace_digest} where id=${CREDENTIAL_BINDING_ID}`;
        else await sql`delete from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
      }
      await lifecycle(
        f.staff.headers,
        { ...command, action: 'pause', revision: verified.revision, idempotencyKey: randomUUID() },
        abort(),
      );
      expect((await worker.run(abort())).results).toEqual([]);
      expect(sourceFetch).toHaveBeenCalledTimes(4);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  async function setupLifecycle() {
    const f = await fixture();
    await sql`update portal_marketing.connections set enabled=false,verified_at=null where id=${f.profile.connectionId}`;
    const profile = {
      ...f.profile,
      acquisitionOwner: 'sale-dashboard' as const,
      sourceConnectionRef: 'synthetic-owner-shop',
    };
    const secrets = {
      shopId: profile.shopId,
      appKey: 'synthetic-key',
      appSecret: 'synthetic-secret',
      accessToken: 'synthetic-token',
      shopCipher: 'synthetic-cipher',
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (raw) =>
      Response.json(
        new URL(String(raw)).pathname === AUTHORIZED_SHOPS_PATH
          ? {
              code: 0,
              request_id: 'native-auth',
              data: { shops: [{ id: profile.shopId, cipher: secrets.shopCipher, region: 'TH' }] },
            }
          : {
              code: 0,
              request_id: 'native-report',
              data: {
                videos: [f.row()],
                total_count: 1,
                latest_available_date: videoDailySchedule(profile.timezone, Date.now(), {
                  historyDays: 1,
                }).from,
                next_page_token: '',
              },
            },
      ),
    );
    const deps = {
      credential: vi.fn().mockResolvedValue(secrets),
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      fetch: fetcher,
    };
    const verifier = createShopVideoVerifier([profile], deps);
    const lifecycle = createShopVideoLifecycle(access, verifier);
    const [c] =
      await sql`select revision::text from portal_marketing.connections where id=${profile.connectionId}`;
    const command = {
      actorId: f.staff.id,
      permissionRevision: '1',
      connectionId: profile.connectionId,
      revision: c.revision,
      action: 'verify',
      idempotencyKey: randomUUID(),
    };
    return { ...f, verifier, lifecycle, command, deps, fetcher };
  }
  it('verifies both signed APIs, enables the scoped shop, then publishes and reads its real native projection', async () => {
    const f = await setupLifecycle();
    const http = createMarketingConnectionsHttp(
      createShopVideoConnections(access, f.verifier),
      'https://partner.example.test',
    );
    const response = await http(
      new Request('https://partner.example.test/api/v1/staff/shop-videos/connections', {
        method: 'POST',
        headers: new Headers([
          ...f.staff.headers,
          ['origin', 'https://partner.example.test'],
          ['content-type', 'application/json'],
        ]),
        body: JSON.stringify(f.command),
      }),
    );
    expect(response.status).toBe(200);
    const verified = await response.json();
    expect(verified.enabled).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const [stored] =
      await sql`select verification from portal_marketing.connections where id=${f.profile.connectionId}`;
    expect(stored.verification).toMatchObject({
      capability: 'tiktok.shop_video',
      authorizationRequestId: 'native-auth',
      analyticsRequestId: 'native-report',
    });
    expect(JSON.stringify(stored)).not.toContain('synthetic-token');
    expect(JSON.stringify(stored)).not.toContain('synthetic-cipher');
    expect(await f.lifecycle(f.staff.headers, f.command, abort())).toMatchObject({
      replayed: true,
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await f.store.plan(f.profile.connectionId, Date.now(), { historyDays: 1 });
    const lease = (await f.store.claimDue(f.profile.connectionId))!;
    const collector = createShopVideoCollector([f.profile], {
      request: createShopVideoTransport([f.profile], f.deps),
    });
    await f.store.publish(lease, await collector(f.profile.connectionId, lease.period, abort()));
    await f.save();
    expect(
      (await f.read(f.viewer.headers, { ...f.partnerQuery, ...lease.period })).items[0].performance,
    ).toMatchObject({ state: 'ready', views: null });
    const paused = await createShopVideoLifecycle(access, null)(
      f.staff.headers,
      { ...f.command, action: 'pause', revision: verified.revision, idempotencyKey: randomUUID() },
      abort(),
    );
    expect(paused.enabled).toBe(false);
    expect(
      (await f.read(f.viewer.headers, { ...f.partnerQuery, ...lease.period })).items[0].performance
        .state,
    ).toBe('stale');
  });
  it('serializes duplicate verify commands and preserves one immutable audit result', async () => {
    const f = await setupLifecycle();
    const results = await Promise.all([
      f.lifecycle(f.staff.headers, f.command, abort()),
      f.lifecycle(f.staff.headers, f.command, abort()),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((r) => r.revision)).size).toBe(1);
    expect(
      await sql`select id from portal_marketing.connection_commands where id=${f.command.idempotencyKey}`,
    ).toHaveLength(1);
  });
  it('allows controlled report retries without clearing source cooldown or account access holds', async () => {
    const f = await setupLifecycle();
    const verified = await f.lifecycle(f.staff.headers, f.command, abort());
    await f.store.plan(f.profile.connectionId, Date.now(), { historyDays: 2 });
    const first = (await f.store.claimDue(f.profile.connectionId))!;
    await f.store.fail(first, 'temporary', 86400000);
    const retry = {
      ...f.command,
      revision: verified.revision,
      action: 'retry',
      idempotencyKey: randomUUID(),
    };
    await f.lifecycle(f.staff.headers, retry, abort());
    const [state] =
      await sql`select state,attempt_count from portal_marketing.video_windows where id=${first.windowId}`;
    expect(state).toEqual({ state: 'queued', attempt_count: 0 });
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
    await sql`update portal_marketing.connection_runtime set blocked_until=clock_timestamp()-interval '1 second' where connection_id=${f.profile.connectionId}`;
    await f.store.fail((await f.store.claimDue(f.profile.connectionId))!, 'access');
    await f.lifecycle(f.staff.headers, { ...retry, idempotencyKey: randomUUID() }, abort());
    expect(await f.store.claimDue(f.profile.connectionId)).toBeNull();
  });
  it('rechecks grants after upstream reads and cannot enable a revoked staff account', async () => {
    const f = await setupLifecycle();
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => {
      const result = await original(url, init);
      if (new URL(String(url)).pathname !== AUTHORIZED_SHOPS_PATH)
        await sql`delete from portal_marketing.connection_grants where connection_id=${f.profile.connectionId} and user_id=${f.staff.id}`;
      return result;
    });
    await expect(f.lifecycle(f.staff.headers, f.command, abort())).rejects.toMatchObject({
      code: 'forbidden',
    });
    const [c] =
      await sql`select enabled,verified_at from portal_marketing.connections where id=${f.profile.connectionId}`;
    expect(c).toEqual({ enabled: false, verified_at: null });
  });
  it('cannot enable from a wrong source shop or a connection changed during verification', async () => {
    const f = await setupLifecycle();
    f.fetcher.mockResolvedValueOnce(
      Response.json({ code: 0, request_id: 'wrong-shop', data: { shops: [] } }),
    );
    await expect(f.lifecycle(f.staff.headers, f.command, abort())).rejects.toMatchObject({
      code: 'access',
    });
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (url, init) => {
      const result = await original(url, init);
      if (new URL(String(url)).pathname !== AUTHORIZED_SHOPS_PATH)
        await sql`update portal_marketing.connections set label='Changed during verification' where id=${f.profile.connectionId}`;
      return result;
    });
    await expect(f.lifecycle(f.staff.headers, f.command, abort())).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(
      (
        await sql`select enabled from portal_marketing.connections where id=${f.profile.connectionId}`
      )[0].enabled,
    ).toBe(false);
  });
});
