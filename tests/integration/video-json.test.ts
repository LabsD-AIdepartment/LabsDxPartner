import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { createShopVideoStore } from '@/server/modules/marketing-ads/tiktok-shop/video-store';
import { createShopVideoCollector } from '@/server/modules/marketing-ads/tiktok-shop/video-collector';
import { VideoObservationSchema } from '@/server/modules/marketing-ads/tiktok-shop/video-contract';

describe.each(['standalone', 'drizzle-shared'] as const)('video JSON persistence: %s', (pool) => {
  it.each(['pages', 'collection'] as const)(
    'stores readable objects through %s publication',
    async (path) => {
      const sql = await connectTestDatabase();
      try {
        if (pool === 'drizzle-shared') drizzle(sql);
        const profile = {
          connectionId: randomUUID(),
          namespace: randomUUID(),
          shopId: randomUUID(),
          currency: 'THB',
          timezone: 'Asia/Bangkok',
        };
        await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
        values(${profile.connectionId},${profile.namespace},'tiktok','tiktok.shop_video',${profile.shopId},'Synthetic JSON test',true,clock_timestamp())`;
        const store = createShopVideoStore(sql, [profile], async () => {});
        const period = { from: '2026-08-01', toExclusive: '2026-08-02' };
        const page = {
          code: 0,
          request_id: randomUUID(),
          data: {
            videos: [
              {
                id: 'video-1',
                title: 'Synthetic JSON',
                creator: {
                  open_id: 'creator-1',
                  user_name: 'sample',
                  nick_name: 'Sample',
                  author_type: 'AFFILIATE',
                },
                views: 0,
                gmv: { amount: '9007199254740993.01', currency: 'THB' },
              },
            ],
            total_count: 1,
            latest_available_date: '2026-08-01',
            next_page_token: '',
          },
        };
        const lease = (await store.claim(profile.connectionId, period))!;
        expect(lease).toBeTruthy();
        if (path === 'pages') {
          const cursor = await store.pages.begin(lease);
          const terminal = await store.pages.append(lease, cursor, {
            kind: 'shop-video-page',
            schemaVersion: 1,
            connection: profile,
            period,
            requestedPageToken: null,
            fetchedAt: new Date().toISOString(),
            page,
          });
          expect((await store.pages.publish(lease, terminal)).state).toBe('published');
        } else {
          const collect = createShopVideoCollector([profile], { request: async () => page });
          await store.publish(
            lease,
            await collect(profile.connectionId, period, new AbortController().signal),
          );
        }
        const [row] =
          await sql`select g.metadata,o.observation,jsonb_typeof(g.metadata) as metadata_kind,
        jsonb_typeof(o.observation) as observation_kind,o.video_id,o.creator_id
        from portal_marketing.video_windows w join portal_marketing.video_generations g on g.id=w.current_generation
        join portal_marketing.video_observations o on o.generation_id=g.id where w.id=${lease.windowId}`;
        expect(row).toMatchObject({
          metadata_kind: 'object',
          observation_kind: 'object',
          video_id: 'video-1',
          creator_id: 'creator-1',
        });
        expect(row.metadata).toMatchObject({
          connection: profile,
          period,
          completeness: 'complete',
        });
        expect(VideoObservationSchema.parse(row.observation)).toMatchObject({
          videoId: 'video-1',
          views: '0',
          paidSkuOrders: null,
          gmv: { amount: '9007199254740993.01', currency: 'THB' },
        });
      } finally {
        await sql.end();
      }
    },
  );
});
