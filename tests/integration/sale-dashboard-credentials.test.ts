import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { createSaleDashboardVideoCredentialResolver } from '@/server/modules/marketing-ads/tiktok-shop/sale-dashboard-credentials';
import { createShopVideoOwnerHandler } from '@/server/modules/marketing-ads/tiktok-shop/owner-handler';
import { createShopVideoOwnerClient } from '@/server/modules/marketing-ads/tiktok-shop/owner-client';
import { AUTHORIZED_SHOPS_PATH } from '@/server/modules/marketing-ads/tiktok-shop/video-transport';
import { createHash } from 'node:crypto';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
beforeAll(async () => {
  sql = await connectTestDatabase();
});
afterAll(async () => {
  await sql.end();
});
it('resolves source-schema snapshots through the owner protocol and denies revoked or rebound accounts', async () => {
  const rollback = new Error('synthetic fixture rollback');
  try {
    await sql.begin(async (tx) => {
      // These exact-name source fixtures must NOT already exist. No IF NOT EXISTS,
      // no source DB connection, no permanent fixture/schema changes: rollback below.
      await tx`create table public.providers (id text primary key, status text not null)`;
      await tx`create table public.provider_credentials (id integer primary key, provider_id text, status text,
        access_token_enc bytea, app_key_enc bytea, app_secret_enc bytea, expires_at timestamptz, scopes jsonb)`;
      await tx`create table public.connected_accounts (id integer primary key, credential_id integer,
        provider_id text, external_account_id text, status text, currency text, timezone text)`;
      await tx`insert into public.providers values ('tiktok','active'),('other','active')`;
      await tx`insert into public.provider_credentials values (9,'tiktok','active',${Buffer.from('synthetic-token')},
        ${Buffer.from('synthetic-app')},${Buffer.from('synthetic-secret')},'2026-09-11T00:00:00Z', '{"shop_cipher":"synthetic-cipher"}')`;
      await tx`insert into public.connected_accounts values (7,9,'tiktok','shop-1','active','THB','Asia/Bangkok')`;
      const profile = {
        connectionId: 'video-1',
        namespace: 'labsd',
        shopId: 'shop-1',
        currency: 'THB',
        timezone: 'Asia/Bangkok',
        acquisitionOwner: 'sale-dashboard' as const,
        sourceConnectionRef: 'source-1',
      };
      const now = () => Date.parse('2026-09-10T00:00:00Z');
      const decryptToken = vi.fn((value: Buffer) => value.toString());
      const credential = createSaleDashboardVideoCredentialResolver(
        [profile],
        [{ sourceConnectionRef: 'source-1', connectedAccountId: 7, credentialId: 9 }],
        {
          // Production port uses node-postgres pool.query(config). Here execute the exact
          // SQL against synthetic source-shaped PostgreSQL tables, no token crypto claim.
          query: async ({ text, values }) => ({ rows: await tx.unsafe(text, values) }),
          decryptToken,
          now,
        },
      );
      const upstream = vi.fn<typeof fetch>(async (url, init) => {
        expect(new Headers(init?.headers).get('x-tts-access-token')).toBe('synthetic-token');
        return Response.json(
          new URL(String(url)).pathname === AUTHORIZED_SHOPS_PATH
            ? {
                code: 0,
                request_id: 'auth',
                data: { shops: [{ id: 'shop-1', cipher: 'synthetic-cipher', region: 'TH' }] },
              }
            : {
                code: 0,
                request_id: 'analytics',
                data: {
                  videos: [],
                  total_count: 0,
                  latest_available_date: '2026-09-09',
                  next_page_token: '',
                },
              },
        );
      });
      const serviceToken = 'synthetic-service-credential-long-enough-for-tests';
      const handler = createShopVideoOwnerHandler(
        [profile],
        [
          {
            tokenSha256: createHash('sha256').update(serviceToken).digest('hex'),
            connectionIds: ['video-1'],
          },
        ],
        {
          credential,
          beforeRequest: async () => {},
          fetch: upstream,
          now,
        },
      );
      const client = createShopVideoOwnerClient(
        [profile],
        'https://owner.example.test',
        serviceToken,
        async (url, init) => handler(new Request(url, init)),
      );
      expect(await client.verify('video-1', new AbortController().signal)).toMatchObject({
        accountId: 'shop-1',
        reportReady: true,
      });
      expect(upstream).toHaveBeenCalledTimes(2);
      for (const mutate of [
        async () => {
          await tx`update public.connected_accounts set status='inactive'`;
        },
        async () => {
          await tx`update public.connected_accounts set status='active', credential_id=10`;
        },
        async () => {
          await tx`update public.connected_accounts set credential_id=9`;
          await tx`update public.provider_credentials set provider_id='other'`;
        },
        async () => {
          await tx`update public.provider_credentials set provider_id='tiktok'`;
          await tx`update public.providers set status='inactive' where id='tiktok'`;
        },
      ]) {
        await mutate();
        await expect(client.verify('video-1', new AbortController().signal)).rejects.toMatchObject({
          code: 'access',
        });
        expect(upstream).toHaveBeenCalledTimes(2);
      }
      expect(decryptToken).toHaveBeenCalledTimes(3);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  expect((await sql`select to_regclass('public.connected_accounts') as name`)[0].name).toBeNull();
});
