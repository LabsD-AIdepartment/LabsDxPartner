import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setup, sql, access } from '../helpers/partner-finance';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { createShopVideoStore } from '@/server/modules/marketing-ads/tiktok-shop/video-store';
import { runShopVideoTick } from '@/server/modules/marketing-ads/tiktok-shop/video-worker';
import type { VideoPageReader } from '@/server/modules/marketing-ads/tiktok-shop/video-page-cycle';
import { videoDailySchedule } from '@/server/modules/marketing-ads/tiktok-shop/video-schedule';
import { createShopVideoRegistration } from '@/server/modules/marketing-ads/tiktok-shop/video-registration';
import { createShopVideoHttp } from '@/server/http/shop-videos';

describe('synthetic video fleet acceptance', () => {
  it('isolates a waiting shop, publishes 100000 exact rows and serves 20 concurrent scoped reads', async () => {
    const f = await setup();
    await f.catalogue();
    const profiles = Array.from({ length: 100 }, () => ({
      connectionId: randomUUID(),
      namespace: randomUUID(),
      shopId: randomUUID(),
      currency: 'THB',
      timezone: 'Asia/Bangkok',
    })).sort((a, b) => a.connectionId.localeCompare(b.connectionId));
    const ids: string[] = profiles.map((p) => p.connectionId);
    for (const p of profiles)
      await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
        values(${p.connectionId},${p.namespace},'tiktok','tiktok.shop_video',${p.shopId},'Synthetic fleet',true,clock_timestamp())`;
    const pools = await Promise.all(Array.from({ length: 4 }, () => connectTestDatabase()));
    const cancel = new AbortController();
    const running: Promise<unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting!: () => void;
    const held = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const tokens = new Map<string, string[]>();
    const active = new Set<string>();
    let overlap = false;
    let released = false;
    const published = new Set<string>();
    const policy = { historyDays: 1 };
    const period = videoDailySchedule('Asia/Bangkok', Date.now(), policy).windows[0].period;
    const start = performance.now();
    const page: VideoPageReader = async (id, requestedPeriod, token, signal) => {
      if (active.has(id)) overlap = true;
      active.add(id);
      try {
        const index = ids.indexOf(id);
        if (index < 0) throw new Error('Unexpected test shop');
        const offset = Number(token ?? '0');
        const calls = tokens.get(id) ?? [];
        calls.push(String(offset));
        tokens.set(id, calls);
        if (id === ids[0] && offset === 0 && !released) {
          waiting();
          await gate;
        }
        signal.throwIfAborted();
        return {
          kind: 'shop-video-page',
          schemaVersion: 1,
          connection: profiles[index],
          period: requestedPeriod,
          requestedPageToken: token,
          fetchedAt: new Date().toISOString(),
          page: {
            code: 0,
            request_id: randomUUID(),
            data: {
              videos: Array.from({ length: 100 }, (_, n) => ({
                id: `video-${offset + n}`,
                title: 'Synthetic fleet video',
                creator: {
                  open_id: 'same-creator',
                  user_name: 'sample',
                  nick_name: 'Sample',
                  author_type: 'AFFILIATE',
                },
                views: index + 1,
                gmv: { amount: '9007199254740993.01', currency: 'THB' },
              })),
              total_count: 1000,
              latest_available_date: requestedPeriod.from,
              next_page_token: offset < 900 ? String(offset + 100) : '',
            },
          },
        };
      } finally {
        active.delete(id);
      }
    };
    const stores = pools.map((pool) => createShopVideoStore(pool, profiles, async () => {}));
    const tick = (index: number) => {
      const task = runShopVideoTick(
        stores[index],
        { page },
        { connectionIds: ids, maxJobs: 5, policy },
        cancel.signal,
      ).then((result) => {
        expect(result.stopped).toBe(false);
        expect(result.results.filter((r) => r.state === 'attention')).toEqual([]);
        for (const r of result.results) if (r.state === 'published') published.add(r.connectionId);
        return result;
      });
      running.push(task);
      return task;
    };
    try {
      const first = tick(0);
      await Promise.race([
        held,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('First shop did not start')), 10000).unref(),
        ),
      ]);
      const peer = await tick(1);
      expect(peer.attempted).toBe(5);
      expect(peer.results.filter((r) => r.state === 'progress')).toHaveLength(5);
      expect(active.has(ids[0])).toBe(true);
      expect(tokens.get(ids[0])).toEqual(['0']);
      released = true;
      release();
      await first;
      let rounds = 0;
      while (published.size < 100 && rounds++ < 40)
        await Promise.all(stores.map((_, index) => tick(index)));
      const acquisitionMs = performance.now() - start;
      expect(published.size).toBe(100);
      expect(overlap).toBe(false);
      for (const id of ids)
        expect(tokens.get(id)).toEqual(Array.from({ length: 10 }, (_, n) => String(n * 100)));
      const [count] =
        await sql`select count(*)::int as rows,count(distinct w.connection_id)::int as shops,
        count(*) filter(where jsonb_typeof(o.observation)<>'object' or o.observation->'gmv'->>'amount'<>'9007199254740993.01')::int as invalid
        from portal_marketing.video_windows w join portal_marketing.video_observations o on o.generation_id=w.current_generation
        where w.connection_id in ${sql(ids)}`;
      expect(count).toEqual({ rows: 100000, shops: 100, invalid: 0 });
      expect(
        await sql`select id from portal_marketing.video_scans where connection_id in ${sql(ids)}`,
      ).toHaveLength(0);

      const selected = profiles[73],
        targetId = randomUUID();
      await sql`insert into portal_marketing.connection_grants(connection_id,user_id) values(${selected.connectionId},${f.staff.id})`;
      await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
        values(${targetId},${f.partnerId},'clip-1','synthetic-fleet','Synthetic fleet','synthetic-only')`;
      const actor = await access.staffSession(f.staff.headers);
      const registration = createShopVideoRegistration(access);
      const { title, creatorName, ...proof } = await registration.lookup(f.staff.headers, {
        actorId: actor.userId,
        permissionRevision: actor.revision,
        targetId,
        connectionId: selected.connectionId,
        videoId: 'video-0',
      });
      void title;
      void creatorName;
      await registration.save(f.staff.headers, { ...proof, idempotencyKey: randomUUID() });
      const http = createShopVideoHttp(access, 'https://partner.example.test', 'partner-read');
      const query = {
        partnerId: f.partnerId,
        permissionRevision: 'p1:m1',
        clipId: 'clip-1',
        ...period,
      };
      const url =
        'https://partner.example.test/api/v1/partner/content/shop-videos?' +
        new URLSearchParams(query);
      const read = async () => {
        const began = performance.now();
        const response = await http(new Request(url, { headers: f.viewer.headers }));
        const wire = await response.text();
        expect(response.status).toBe(200);
        const body = JSON.parse(wire);
        expect(body.items).toHaveLength(1);
        expect(body.items[0].performance).toMatchObject({
          state: 'ready',
          views: '74',
          gmv: { amount: '9007199254740993.01', currency: 'THB' },
        });
        expect(wire).not.toContain(selected.shopId);
        return { ms: performance.now() - began, bytes: Buffer.byteLength(wire) };
      };
      const firstRead = await read();
      const samples = [];
      for (let batch = 0; batch < 5; batch++)
        samples.push(...(await Promise.all(Array.from({ length: 20 }, read))));
      const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
      expect((await http(new Request(url))).status).toBe(401);
      const otherClip = await http(
        new Request(url.replace('clip-1', 'clip-2'), { headers: f.viewer.headers }),
      );
      expect(otherClip.status).toBe(200);
      expect((await otherClip.json()).items).toEqual([]);
      process.stdout.write(
        'Synthetic fleet measurement ' +
          JSON.stringify({
            shops: 100,
            observations: count.rows,
            workers: 4,
            workerPoolLimit: 2,
            authPoolLimit: 2,
            acquisitionMs,
            sourcePageCalls: [...tokens.values()].reduce((n, v) => n + v.length, 0),
            readConcurrency: 20,
            requests: samples.length,
            firstReadMs: firstRead.ms,
            p50Ms: sorted[49],
            p95Ms: sorted[94],
            maxMs: sorted[99],
            maxBytes: Math.max(...samples.map((s) => s.bytes)),
          }) +
          '\n',
      );
      // This is the agreed local warm-handler budget, not a live/browser guarantee.
      expect(sorted[94]).toBeLessThanOrEqual(500);
    } finally {
      cancel.abort();
      released = true;
      release();
      await Promise.allSettled(running);
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });
});
