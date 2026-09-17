import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sql, setup } from '../helpers/partner-finance';
import { createShopVideoStore } from '@/server/modules/marketing-ads/tiktok-shop/video-store';
import { createConfiguredShopVideoWorker } from '@/server/modules/marketing-ads/tiktok-shop/video-composition';
import { createShopVideoOwnerHandler } from '@/server/modules/marketing-ads/tiktok-shop/owner-handler';
import { createHash } from 'node:crypto';
import { publishVideoPageBatch } from '@/server/modules/marketing-ads/tiktok-shop/video-page-cycle';
import { SourceReadError } from '@/server/modules/marketing-ads/source-error';
import { videoDailySchedule } from '@/server/modules/marketing-ads/tiktok-shop/video-schedule';
import type { VideoPageEvidence } from '@/server/modules/marketing-ads/tiktok-shop/video-page';
const signal = () => new AbortController().signal;
const period = videoDailySchedule('Asia/Bangkok', Date.now(), { historyDays: 1 }).windows[0].period;
async function fixture() {
  const f = await setup();
  const profile = {
    connectionId: randomUUID(),
    namespace: randomUUID(),
    shopId: randomUUID(),
    currency: 'THB',
    timezone: 'Asia/Bangkok',
  };
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
    values(${profile.connectionId},${profile.namespace},'tiktok','tiktok.shop_video',${profile.shopId},'Synthetic scan',true,clock_timestamp())`;
  const binding = async () => {};
  const store = () => createShopVideoStore(sql, [profile], binding);
  const row = (id: string) => ({
    id,
    title: 'Synthetic clip',
    creator: {
      open_id: 'creator',
      user_name: 'creator',
      nick_name: 'Creator',
      author_type: 'AFFILIATE' as const,
    },
    views: 0,
    gmv: { amount: '9007199254740993.01', currency: 'THB' },
  });
  const page = (
    token: string | null,
    ids: string[],
    total: number,
    next: string | null,
  ): VideoPageEvidence => ({
    kind: 'shop-video-page',
    schemaVersion: 1,
    connection: profile,
    period,
    requestedPageToken: token,
    fetchedAt: new Date().toISOString(),
    page: {
      code: 0,
      request_id: randomUUID(),
      data: {
        videos: ids.map(row),
        total_count: total,
        latest_available_date: period.from,
        next_page_token: next ?? '',
      },
    },
  });
  const lease = () => store().claim(profile.connectionId, period);
  const state = async () =>
    (
      await sql`select * from portal_marketing.video_windows where connection_id=${profile.connectionId} and period_from=${period.from}::date and period_to=${period.toExclusive}::date`
    )[0];
  return { ...f, profile, store, row, page, lease, state, binding };
}
describe('native durable video scans', () => {
  it('survives a hard process kill mid-page and resumes after the real lease expires', async () => {
    const f = await fixture();
    const profile = {
      ...f.profile,
      acquisitionOwner: 'sale-dashboard' as const,
      sourceConnectionRef: 'synthetic-crash-source',
    };
    // Last-good data must stay visible until the replacement generation is complete.
    await publishVideoPageBatch(
      f.store(),
      async () => f.page(null, ['last-good'], 1, null),
      (await f.lease())!,
      signal(),
    );
    const good = (await f.state()).current_generation;
    const serviceToken = 'synthetic-process-crash-owner-token-32-chars';
    const tokens: string[] = [];
    let hold = true;
    let sawBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => {
      sawBlocked = resolve;
    });
    const owner = createShopVideoOwnerHandler(
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
          shopCipher: 'synthetic-cipher',
          appKey: 'synthetic-key',
          appSecret: 'synthetic-secret',
          accessToken: 'synthetic-token',
        }),
        beforeRequest: async () => {},
        fetch: async (raw, init) => {
          const start = Number(new URL(String(raw)).searchParams.get('page_token') || '0');
          tokens.push(String(start));
          if (start === 100 && hold) {
            sawBlocked();
            await new Promise<void>((_, reject) => {
              const abort = () => reject(new Error('Synthetic request disconnected'));
              if (init?.signal?.aborted) abort();
              else init?.signal?.addEventListener('abort', abort, { once: true });
            });
          }
          const size = Math.min(100, 2101 - start);
          return Response.json({
            code: 0,
            request_id: randomUUID(),
            data: {
              videos: Array.from({ length: size }, (_, i) => f.row(String(start + i))),
              total_count: 2101,
              latest_available_date: period.from,
              next_page_token: start + size < 2101 ? String(start + size) : '',
            },
          });
        },
      },
    );
    const server = createServer(async (req, res) => {
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk);
        const headers = new Headers();
        for (let i = 0; i < req.rawHeaders.length; i += 2)
          headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
        const result = await owner(
          new Request('http://127.0.0.1' + req.url, {
            method: req.method,
            headers,
            body: Buffer.concat(chunks),
            signal: abort.signal,
          }),
        );
        if (!res.destroyed) {
          res.writeHead(result.status);
          res.end(await result.text());
        }
      } catch {
        if (!res.destroyed) res.writeHead(503).end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No loopback port');
    const children: ChildProcess[] = [];
    function launch() {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'tests/helpers/video-worker-child.ts'],
        {
          cwd: process.cwd(),
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          env: {
            ...process.env,
            TSX_DISABLE_CACHE: '1',
            TMPDIR: resolve('.agent-work/runtime/tmp'),
            XDG_CACHE_HOME: resolve('.agent-work/runtime/cache'),
            TEST_VIDEO_CONNECTION: profile.connectionId,
            TEST_VIDEO_NAMESPACE: profile.namespace,
            LABSD_MARKETING_ENABLED: '1',
            LABSD_TIKTOK_VIDEO_ENABLED: '1',
            LABSD_TIKTOK_VIDEO_SYNC_ENABLED: '1',
            LABSD_TIKTOK_VIDEO_PROFILES: JSON.stringify([profile]),
            LABSD_TIKTOK_OWNER_ORIGIN: `http://127.0.0.1:${(address as AddressInfo).port}`,
            LABSD_TIKTOK_OWNER_SERVICE_TOKEN: serviceToken,
          },
        },
      );
      children.push(child);
      child.stdout?.resume();
      child.stderr?.resume();
      return child;
    }
    try {
      const child = launch();
      await Promise.race([
        blocked,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Worker did not reach second page')), 10000).unref(),
        ),
      ]);
      const [staged] =
        await sql`select id,window_id,page_count,next_token from portal_marketing.video_scans where connection_id=${profile.connectionId}`;
      expect(staged).toMatchObject({ page_count: 1, next_token: '100' });
      const stagedWindow = async () =>
        (await sql`select * from portal_marketing.video_windows where id=${staged.window_id}`)[0];
      expect((await stagedWindow()).current_generation).toBeNull();
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      expect(child.signalCode).toBe('SIGKILL');
      expect((await f.state()).current_generation).toBe(good);
      expect(await f.store().claim(profile.connectionId, period)).toBeNull();
      const [lease] =
        await sql`select greatest(0,extract(epoch from (lease_until-clock_timestamp()))*1000)::float8 as remaining from portal_marketing.connection_runtime where connection_id=${profile.connectionId}`;
      expect(lease.remaining).toBeGreaterThan(60000);
      console.log('Crash observed; waiting for native lease expiry', {
        pid: child.pid,
        remainingMs: Math.ceil(lease.remaining),
      });
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(lease.remaining) + 100));
      hold = false;
      const replacement = launch(),
        done = once(replacement, 'exit');
      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Replacement timed out')), 15000).unref(),
        ),
      ]);
      expect(replacement.exitCode).toBe(0);
      expect(replacement.pid).not.toBe(child.pid);
      const state = await stagedWindow();
      expect(state.current_generation).toBeTruthy();
      expect((await f.state()).current_generation).toBe(good);
      const rows =
        await sql`select observation from portal_marketing.video_observations where generation_id=${state.current_generation}`;
      expect(rows).toHaveLength(2101);
      expect(new Set(rows.map((r) => r.observation.videoId)).size).toBe(2101);
      expect(rows.every((r) => r.observation.gmv.amount === '9007199254740993.01')).toBe(true);
      expect(tokens.slice(0, 3)).toEqual(['0', '100', '100']);
      expect(tokens.filter((t) => t === '0')).toHaveLength(1);
      expect(
        await sql`select id from portal_marketing.video_scans where connection_id=${profile.connectionId}`,
      ).toHaveLength(0);
      console.log('Replacement completed after hard kill', {
        oldPid: child.pid,
        newPid: replacement.pid,
        rows: rows.length,
        pages: tokens.length,
      });
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const ended = once(child, 'exit');
          child.kill('SIGKILL');
          await ended;
        }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120000);

  it('configured worker reads >2000 rows across recreated workers and publishes only the final complete generation', async () => {
    const f = await fixture(),
      calls: string[] = [];
    const profile = {
      ...f.profile,
      acquisitionOwner: 'sale-dashboard' as const,
      sourceConnectionRef: 'synthetic-source',
    };
    const serviceToken = 'synthetic-durable-owner-test-token-32-chars';
    const source = vi.fn(async (raw: RequestInfo | URL) => {
      const token = new URL(String(raw)).searchParams.get('page_token') ?? '0';
      calls.push(token);
      const start = Number(token),
        size = Math.min(100, 2101 - start);
      return Response.json({
        code: 0,
        request_id: randomUUID(),
        data: {
          videos: Array.from({ length: size }, (_, i) => f.row(String(start + i))),
          total_count: 2101,
          latest_available_date: period.from,
          next_page_token: start + size < 2101 ? String(start + size) : '',
        },
      });
    });
    const quota = vi.fn(async () => {}),
      credential = vi.fn(async () => ({
        shopId: profile.shopId,
        shopCipher: 'synthetic-cipher',
        appKey: 'synthetic-key',
        appSecret: 'synthetic-secret',
        accessToken: 'synthetic-token',
      }));
    const owner = createShopVideoOwnerHandler(
      [profile],
      [
        {
          tokenSha256: createHash('sha256').update(serviceToken).digest('hex'),
          connectionIds: [profile.connectionId],
        },
      ],
      { credential, beforeRequest: quota, fetch: source },
    );
    const env = {
      LABSD_MARKETING_ENABLED: '1',
      LABSD_TIKTOK_VIDEO_ENABLED: '1',
      LABSD_TIKTOK_VIDEO_SYNC_ENABLED: '1',
      LABSD_TIKTOK_VIDEO_PROFILES: JSON.stringify([profile]),
      LABSD_TIKTOK_OWNER_ORIGIN: 'https://owner.example.test',
      LABSD_TIKTOK_OWNER_SERVICE_TOKEN: serviceToken,
    };
    for (let n = 0; n < 11; n++) {
      const worker = createConfiguredShopVideoWorker(sql, env, f.binding, async (url, init) =>
        owner(new Request(url, init)),
      )!;
      const result = await worker.run(signal());
      expect(result.results[0].state).toBe(n < 10 ? 'progress' : 'published');
      expect((await f.state()).current_generation === null).toBe(n < 10);
    }
    expect(calls).toEqual(Array.from({ length: 22 }, (_, i) => String(i * 100)));
    expect(quota).toHaveBeenCalledTimes(22);
    expect(credential).toHaveBeenCalledTimes(22);
    const generation = (await f.state()).current_generation;
    const rows =
      await sql`select observation from portal_marketing.video_observations where generation_id=${generation}`;
    expect(rows).toHaveLength(2101);
    expect(rows[0].observation).toMatchObject({
      views: '0',
      paidSkuOrders: null,
      gmv: { amount: '9007199254740993.01', currency: 'THB' },
    });
    expect(
      await sql`select 1 from portal_marketing.video_scans where connection_id=${profile.connectionId}`,
    ).toHaveLength(0);
  }, 30000);
  it('reclaims an expired lease at its persisted cursor and fences the stale worker', async () => {
    const f = await fixture(),
      old = (await f.lease())!;
    const first = await f.store().pages.begin(old);
    const next = await f.store().pages.append(old, first, f.page(null, ['a'], 2, 'next'));
    await sql`update portal_marketing.connection_runtime set lease_until=clock_timestamp()-interval '1 second' where connection_id=${f.profile.connectionId}`;
    await sql`update portal_marketing.video_windows set lease_until=clock_timestamp()-interval '1 second' where id=${old.windowId}`;
    const fresh = (await f.lease())!;
    expect(fresh.token).not.toBe(old.token);
    expect(await f.store().pages.begin(fresh)).toEqual({
      id: next.id,
      pageCount: 1,
      pageToken: 'next',
    });
    await expect(
      f.store().pages.append(old, next, f.page('next', ['b'], 2, null)),
    ).rejects.toMatchObject({ code: 'access' });
    const done = await f.store().pages.append(fresh, next, f.page('next', ['b'], 2, null));
    expect((await f.store().pages.publish(fresh, done)).state).toBe('published');
    await expect(f.store().pages.discard(old)).rejects.toMatchObject({ code: 'access' });
  });
  it('resumes a terminal staged page without another source read', async () => {
    const f = await fixture(),
      lease = (await f.lease())!,
      cursor = await f.store().pages.begin(lease);
    await f.store().pages.append(lease, cursor, f.page(null, ['a'], 1, null));
    await f.store().pages.release(lease);
    const reader = vi.fn();
    expect(
      (await publishVideoPageBatch(f.store(), reader, (await f.lease())!, signal())).state,
    ).toBe('published');
    expect(reader).not.toHaveBeenCalled();
  });
  it.each(['duplicate', 'count', 'watermark', 'cursor', 'wrong-shop', 'wrong-period'] as const)(
    'rejects %s without advancing the durable cursor',
    async (kind) => {
      const f = await fixture(),
        lease = (await f.lease())!,
        start = await f.store().pages.begin(lease);
      const c = await f.store().pages.append(lease, start, f.page(null, ['a'], 3, 'next'));
      const p = f.page('next', ['b'], 3, 'last');
      if (kind === 'duplicate') p.page.data.videos = [f.row('a')];
      if (kind === 'count') p.page.data.total_count = 4;
      if (kind === 'watermark') p.page.data.latest_available_date = '2026-01-01';
      if (kind === 'cursor') p.requestedPageToken = 'wrong';
      if (kind === 'wrong-shop') p.connection = { ...p.connection, shopId: 'another' };
      if (kind === 'wrong-period') p.period = { from: '2026-01-01', toExclusive: '2026-01-02' };
      await expect(f.store().pages.append(lease, c, p)).rejects.toMatchObject({
        code: 'invalid-source',
      });
      expect(await f.store().pages.begin(lease)).toMatchObject({ pageCount: 1, pageToken: 'next' });
      expect((await f.state()).current_generation).toBeNull();
    },
  );
  it('retains last-good generation and cursor through quota cooldown and cancellation', async () => {
    const f = await fixture(),
      first = (await f.lease())!;
    await publishVideoPageBatch(
      f.store(),
      async () => f.page(null, ['old'], 1, null),
      first,
      signal(),
    );
    const good = (await f.state()).current_generation;
    const lease = (await f.lease())!,
      cursor = await f.store().pages.begin(lease);
    await f.store().pages.append(lease, cursor, f.page(null, ['a'], 2, 'next'));
    await expect(
      publishVideoPageBatch(
        f.store(),
        async () => {
          throw new SourceReadError('throttled', 90000);
        },
        lease,
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'throttled' });
    expect((await f.state()).current_generation).toBe(good);
    expect(await f.lease()).toBeNull();
    const [scan] =
      await sql`select next_token from portal_marketing.video_scans where connection_id=${f.profile.connectionId}`;
    expect(scan.next_token).toBe('next');
    await sql`update portal_marketing.connection_runtime set blocked_until=clock_timestamp() where connection_id=${f.profile.connectionId}`;
    const again = (await f.lease())!,
      abort = new AbortController();
    await expect(
      publishVideoPageBatch(
        f.store(),
        async () => {
          abort.abort();
          return f.page('next', ['b'], 2, null);
        },
        again,
        abort.signal,
      ),
    ).rejects.toBeDefined();
    expect((await f.state()).current_generation).toBe(good);
    expect(
      (
        await sql`select next_token from portal_marketing.video_scans where connection_id=${f.profile.connectionId}`
      )[0].next_token,
    ).toBe('next');
  });
  it('automatically restarts a rejected cursor once then pauses repeated invalid source data', async () => {
    const f = await fixture();
    for (let n = 0; n < 2; n++) {
      const lease = (await f.lease())!;
      await expect(
        publishVideoPageBatch(
          f.store(),
          async () => {
            throw new SourceReadError('invalid-source');
          },
          lease,
          signal(),
        ),
      ).rejects.toMatchObject({ code: 'invalid-source' });
      expect((await f.state()).retry_paused).toBe(n === 1);
      expect(
        await sql`select 1 from portal_marketing.video_scans where connection_id=${f.profile.connectionId}`,
      ).toHaveLength(0);
    }
  });
  it('rejects an expired scan and stops a revoked connection from publishing', async () => {
    const f = await fixture(),
      lease = (await f.lease())!,
      cursor = await f.store().pages.begin(lease);
    await sql`update portal_marketing.video_scans set created_at=clock_timestamp()-interval '3 hours' where id=${cursor.id}`;
    await expect(f.store().pages.begin(lease)).rejects.toMatchObject({ code: 'invalid-source' });
    await sql`update portal_marketing.connections set enabled=false where id=${f.profile.connectionId}`;
    await expect(
      f.store().pages.append(lease, cursor, f.page(null, ['a'], 1, null)),
    ).rejects.toMatchObject({ code: 'access' });
  });
  it('rejects scan page/row/byte bounds without partial publication', async () => {
    const f = await fixture(),
      lease = (await f.lease())!,
      cursor = await f.store().pages.begin(lease);
    await expect(
      f.store().pages.append(lease, cursor, f.page(null, ['a'], 20001, 'next')),
    ).rejects.toMatchObject({ code: 'page-limit' });
    await sql`update portal_marketing.video_scans set byte_count=33554432 where id=${cursor.id}`;
    await expect(
      f.store().pages.append(lease, cursor, f.page(null, ['a'], 1, null)),
    ).rejects.toMatchObject({ code: 'page-limit' });
    await sql`update portal_marketing.video_scans set byte_count=0,page_count=200,next_token='next',expected_count=201,row_count=200,latest_date=${period.from}::date where id=${cursor.id}`;
    await expect(
      f
        .store()
        .pages.append(
          lease,
          { ...cursor, pageCount: 200, pageToken: 'next' },
          f.page('next', ['last'], 201, null),
        ),
    ).rejects.toMatchObject({ code: 'page-limit' });
    expect((await f.state()).current_generation).toBeNull();
  });
  it('does not publish a behind-source watermark or incomplete terminal count', async () => {
    const f = await fixture(),
      lease = (await f.lease())!,
      cursor = await f.store().pages.begin(lease);
    await expect(
      f.store().pages.append(lease, cursor, f.page(null, ['a'], 2, null)),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    const behind = f.page(null, ['a'], 1, null);
    behind.page.data.latest_available_date = '2026-01-01';
    expect(
      (await publishVideoPageBatch(f.store(), async () => behind, lease, signal())).state,
    ).toBe('partial');
    expect((await f.state()).current_generation).toBeNull();
    expect(
      await sql`select 1 from portal_marketing.video_scans where connection_id=${f.profile.connectionId}`,
    ).toHaveLength(0);
  });
  it('fences a changed schedule and discards only the incompatible unfinished scan on the next claim', async () => {
    const f = await fixture(),
      store = f.store();
    await store.plan(f.profile.connectionId, Date.now(), { historyDays: 1 });
    const lease = (await store.claimDue(f.profile.connectionId))!,
      cursor = await store.pages.begin(lease);
    const next = await store.pages.append(lease, cursor, f.page(null, ['a'], 2, 'next'));
    await store.plan(f.profile.connectionId, Date.now() + 86400000, { historyDays: 1 });
    await expect(
      store.pages.append(lease, next, f.page('next', ['b'], 2, null)),
    ).rejects.toMatchObject({ code: 'access' });
    await sql`update portal_marketing.connection_runtime set lease_until=clock_timestamp()-interval '1 second' where connection_id=${f.profile.connectionId}`;
    const fresh = (await store.claimDue(f.profile.connectionId))!;
    expect(fresh.windowId).not.toBe(lease.windowId);
    const restarted = await store.pages.begin(fresh);
    expect(restarted.pageCount).toBe(0);
    expect(restarted.id).not.toBe(cursor.id);
  });
  it('pauses operational limits immediately without restarting or replacing last-good data', async () => {
    const f = await fixture();
    await f.store().plan(f.profile.connectionId, Date.now(), { historyDays: 2 });
    const old = (await f.lease())!;
    await publishVideoPageBatch(
      f.store(),
      async () => f.page(null, ['old'], 1, null),
      old,
      signal(),
    );
    const good = (await f.state()).current_generation,
      lease = (await f.lease())!;
    const source = vi.fn(async () => f.page(null, ['a'], 20001, 'next'));
    await expect(publishVideoPageBatch(f.store(), source, lease, signal())).rejects.toMatchObject({
      code: 'page-limit',
    });
    expect(source).toHaveBeenCalledTimes(1);
    const other = await f.store().claimDue(f.profile.connectionId);
    expect(other).not.toBeNull();
    expect(other!.windowId).not.toBe(lease.windowId);
    expect(await f.state()).toMatchObject({
      issue: 'page-limit',
      retry_paused: true,
      current_generation: good,
    });
    expect(
      await sql`select 1 from portal_marketing.video_scans where connection_id=${f.profile.connectionId}`,
    ).toHaveLength(0);
  });
  it('a diagnostic complete publication discards older staging for the same window', async () => {
    const f = await fixture(),
      lease = (await f.lease())!,
      cursor = await f.store().pages.begin(lease);
    await f.store().pages.append(lease, cursor, f.page(null, ['old-a'], 2, 'old-next'));
    await f.store().pages.release(lease);
    const { createShopVideoCollector } =
      await import('@/server/modules/marketing-ads/tiktok-shop/video-collector');
    const collect = createShopVideoCollector([f.profile], {
      request: async () => f.page(null, ['new'], 1, null).page,
    });
    const fresh = (await f.lease())!;
    const publication = await f
      .store()
      .publish(fresh, await collect(f.profile.connectionId, period, signal()));
    expect((await f.state()).current_generation).toBe(publication.generationId);
    const nextLease = (await f.lease())!,
      next = await f.store().pages.begin(nextLease);
    expect(next.id).not.toBe(cursor.id);
    expect(next.pageToken).toBeNull();
    expect(next.pageCount).toBe(0);
  });
});
