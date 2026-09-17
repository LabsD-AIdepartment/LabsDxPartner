import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createMarketingRegistration } from '@/server/modules/marketing-ads/registration';
import {
  createMarketingProviderRegistry,
  type MarketingReadAdapter,
} from '@/server/modules/marketing-ads/provider';
import { createMarketingAdsHttp } from '@/server/http/marketing-ads';
import { readRegistration } from '@/features/marketing-ads/model';
import type { AdRegistrationTransport } from '@/features/marketing-ads/model';
import { createFacebookAdapter } from '@/server/modules/marketing-ads/facebook/adapter';
import { NativeAdReceipt } from '@/contracts/marketing-native';

async function fixture(
  onResolve?: MarketingReadAdapter['resolve'],
  accountId: string = randomUUID(),
) {
  const f = await setup();
  await f.catalogue();
  const targetId = randomUUID(),
    connectionId = randomUUID();
  await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
    values(${targetId},${f.partnerId},'clip-1','synthetic-agreement','ดีลตัวอย่าง','synthetic-deal-ref')`;
  await sql`insert into portal_marketing.connections(id,namespace,platform,capability,account_id,label,enabled,verified_at)
    values(${connectionId},'test','facebook','facebook.ad_insights',${accountId},'บัญชีทดสอบ',true,clock_timestamp())`;
  await sql`insert into portal_marketing.connection_grants(connection_id,user_id) values(${connectionId},${f.staff.id})`;
  const scope = { actorId: f.staff.id, permissionRevision: '1' };
  const draft = {
    targetId,
    connectionId,
    platform: 'facebook' as const,
    externalId: '123456789012345678901',
  };
  const adapter: MarketingReadAdapter = {
    capability: 'facebook.ad_insights',
    resolve:
      onResolve ??
      (async (identity) => ({
        schemaVersion: 2,
        identity,
        apiVersion: 'test-v1',
        sourceRevision: null,
        name: 'Synthetic ad',
        creativeIds: ['creative-1'],
        fetchedAt: new Date().toISOString(),
      })),
    report: async () => {
      throw new Error('not used');
    },
  };
  const registry = createMarketingProviderRegistry([adapter]);
  const service = createMarketingRegistration(access, registry);
  const lookup = { ...scope, draft };
  const resolve = () => service.resolve(f.staff.headers, lookup, new AbortController().signal);
  const save = (receipt: string, idempotencyKey = randomUUID()) =>
    service.save(f.staff.headers, { ...lookup, receipt, idempotencyKey });
  return { ...f, scope, draft, lookup, service, registry, resolve, save };
}
describe('native marketing registration', () => {
  it('resolves with the real Facebook adapter and persists through authenticated HTTP using only fake upstream fetch', async () => {
    const accountId = BigInt('0x' + randomUUID().replaceAll('-', '')).toString();
    const f = await fixture(undefined, accountId),
      calls: string[] = [];
    const adapter = createFacebookAdapter(
      [
        {
          id: f.draft.connectionId,
          namespace: 'test',
          accountId,
          currency: 'THB',
          timezone: 'Asia/Bangkok',
        },
      ],
      {
        credential: async () => ({ token: 'synthetic-http-facebook' }),
        fetch: async (input, init) => {
          expect(init?.method).toBe('GET');
          const url = new URL(String(input));
          calls.push(url.pathname);
          return Response.json(
            url.pathname.endsWith('/act_' + accountId)
              ? {
                  id: 'act_' + accountId,
                  account_id: accountId,
                  currency: 'THB',
                  timezone_name: 'Asia/Bangkok',
                }
              : {
                  id: f.draft.externalId,
                  account_id: accountId,
                  name: 'Facebook source fixture',
                  effective_status: 'ACTIVE',
                  creative: { id: '345' },
                },
          );
        },
      },
    );
    const service = createMarketingRegistration(access, createMarketingProviderRegistry([adapter]));
    const headers = new Headers(f.staff.headers);
    headers.set('origin', config.BETTER_AUTH_URL);
    headers.set('content-type', 'application/json');
    const invoke = (action: 'resolve' | 'save', body: unknown) =>
      createMarketingAdsHttp(
        service,
        config.BETTER_AUTH_URL,
        action,
      )(
        new Request(config.BETTER_AUTH_URL + '/api/v1/staff/ads/' + action, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      );
    const found = await invoke('resolve', f.lookup);
    expect(found.status).toBe(200);
    const receipt = NativeAdReceipt.parse(await found.json());
    const saved = await invoke('save', {
      ...f.lookup,
      receipt: receipt.receipt,
      idempotencyKey: randomUUID(),
    });
    expect(saved.status).toBe(200);
    const snapshot = await service.read(headers, f.scope);
    expect(snapshot.associations).toHaveLength(1);
    expect(snapshot.associations[0]).toMatchObject({
      creativeId: '345',
      name: 'Facebook source fixture',
      sync: 'queued',
    });
    expect(calls).toEqual(['/v25.0/act_' + accountId, '/v25.0/' + f.draft.externalId]);
  });
  it('records an existing clip/deal reference with audit and rejects unknown clips or conflicting evidence', async () => {
    const f = await fixture();
    const command = {
      ...f.scope,
      partnerId: f.partnerId,
      clipId: 'clip-2',
      agreementId: 'deal-2',
      agreementLabel: 'ดีลที่ตกลงแล้ว',
      evidenceRef: 'agreement-reference',
      idempotencyKey: randomUUID(),
    };
    const created = await f.service.createTarget(f.staff.headers, command);
    expect(created.replayed).toBe(false);
    const choices = await f.service.targetOptions(f.staff.headers, {
      ...f.scope,
      q: 'no-such-clip-' + randomUUID(),
    });
    expect(choices.clips).toEqual([]);
    expect(choices.hasMore).toBe(false);
    expect((await f.service.createTarget(f.staff.headers, command)).targetId).toBe(
      created.targetId,
    );
    await expect(
      f.service.createTarget(f.staff.headers, {
        ...command,
        clipId: 'missing',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      f.service.createTarget(f.staff.headers, {
        ...command,
        evidenceRef: 'other',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const rows = await sql`select * from portal_access.audit where target_id=${created.targetId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('create-ad-target');
  });
  it('rolls back mapping and queued work together when the transaction cannot commit', async () => {
    const f = await fixture(),
      receipt = await f.resolve();
    const wrapped = new Proxy(access, {
      get(target, property, receiver) {
        if (property !== 'withStaffCapability') return Reflect.get(target, property, receiver);
        return (...args: Parameters<typeof access.withStaffCapability>) => {
          const [headers, capability, write, callback] = args;
          return access.withStaffCapability(headers, capability, write, async (tx, actor) => {
            await callback(tx, actor);
            throw new Error('synthetic commit failure');
          });
        };
      },
    });
    await expect(
      createMarketingRegistration(wrapped, f.registry).save(f.staff.headers, {
        ...f.lookup,
        receipt: receipt.receipt,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow('synthetic commit failure');
    expect(
      await sql`select * from portal_marketing.associations where connection_id=${f.draft.connectionId}`,
    ).toHaveLength(0);
    expect(
      await sql`select j.* from portal_marketing.sync_jobs j join portal_marketing.associations a on a.id=j.association_id where a.connection_id=${f.draft.connectionId}`,
    ).toHaveLength(0);
  });
  it('persists mapping and job atomically; recreated service reads history and replay does not duplicate', async () => {
    const f = await fixture(),
      receipt = await f.resolve(),
      key = randomUUID();
    const saved = await f.save(receipt.receipt, key);
    expect(saved.replayed).toBe(false);
    expect((await f.save(receipt.receipt, key)).replayed).toBe(true);
    expect((await f.save(receipt.receipt)).associationId).toBe(saved.associationId);
    const service = createMarketingRegistration(access, f.registry);
    const snapshot = await service.read(f.staff.headers, f.scope);
    expect(snapshot.associations).toHaveLength(1);
    expect(snapshot.associations[0]).toMatchObject({
      externalId: f.draft.externalId,
      sync: 'queued',
      dataThrough: null,
    });
    const jobs =
      await sql`select * from portal_marketing.sync_jobs where association_id=${saved.associationId}`;
    expect(jobs).toHaveLength(1);
    const audits =
      await sql`select * from portal_access.audit where target_id=${saved.associationId}`;
    expect(audits).toHaveLength(2);
  });
  it('keeps disabled/archived history visible but prevents new lookup', async () => {
    const f = await fixture(),
      r = await f.resolve();
    await f.save(r.receipt);
    await sql`update portal_marketing.connections set enabled=false where id=${f.draft.connectionId}`;
    await sql`update portal_marketing.targets set active=false where id=${f.draft.targetId}`;
    const transport: AdRegistrationTransport = {
      read: () => f.service.read(f.staff.headers, f.scope),
      resolve: async () => {
        throw new Error('unused');
      },
      save: async () => {
        throw new Error('unused');
      },
    };
    const snapshot = await readRegistration(transport, f.scope, new AbortController().signal);
    expect(snapshot.associations).toHaveLength(1);
    expect(snapshot.targets.find((t) => t.id === f.draft.targetId)?.available).toBe(false);
    expect(snapshot.connections[0].availability.phase).toBe('disabled');
    await expect(f.resolve()).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects unauthenticated, partner-only, forged actor and ungranted connection access', async () => {
    const f = await fixture();
    await expect(f.service.read(new Headers(), f.scope)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(f.service.read(f.viewer.headers, f.scope)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      f.service.read(f.staff.headers, { ...f.scope, actorId: f.viewer.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await sql`delete from portal_marketing.connection_grants where connection_id=${f.draft.connectionId}`;
    await expect(f.resolve()).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rechecks access after provider I/O', async () => {
    const f = await fixture(async (identity) => {
      await sql`delete from portal_marketing.connection_grants where connection_id=${identity.connectionId}`;
      return {
        schemaVersion: 2,
        identity,
        apiVersion: 'test',
        sourceRevision: null,
        name: 'Test',
        creativeIds: ['c'],
        fetchedAt: new Date().toISOString(),
      };
    });
    await expect(f.resolve()).rejects.toMatchObject({ code: 'forbidden' });
    const rows =
      await sql`select * from portal_marketing.lookup_receipts where actor_id=${f.staff.id}`;
    expect(rows).toHaveLength(0);
  });
  it('auto-revisions changed targets and rejects stale/expired/tampered receipts', async () => {
    const f = await fixture(),
      r = await f.resolve();
    await sql`update portal_marketing.targets set agreement_label='Changed' where id=${f.draft.targetId}`;
    await expect(f.save(r.receipt)).rejects.toMatchObject({ code: 'conflict' });
    const current = await f.resolve();
    await expect(
      f.service.save(f.staff.headers, {
        ...f.lookup,
        draft: { ...f.draft, externalId: 'different' },
        receipt: current.receipt,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await sql`update portal_marketing.lookup_receipts set expires_at=clock_timestamp()-interval '1 second' where id=${current.receipt}`;
    await expect(f.save(current.receipt)).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      sql`update portal_marketing.targets set clip_id='clip-2' where id=${f.draft.targetId}`,
    ).rejects.toThrow('different binding');
    await expect(
      sql`update portal_marketing.connections set account_id='other' where id=${f.draft.connectionId}`,
    ).rejects.toThrow('different identity');
  });
  it('refuses a different clip for the same canonical ad and serializes concurrent duplicate saves', async () => {
    const f = await fixture(),
      r = await f.resolve();
    const results = await Promise.all([f.save(r.receipt), f.save(r.receipt)]);
    expect(new Set(results.map((r) => r.associationId)).size).toBe(1);
    const targetId = randomUUID();
    await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref)
      values(${targetId},${f.partnerId},'clip-2','other','Other','test')`;
    const other = { ...f.lookup, draft: { ...f.draft, targetId } };
    const r2 = await f.service.resolve(f.staff.headers, other, new AbortController().signal);
    await expect(
      f.service.save(f.staff.headers, {
        ...other,
        receipt: r2.receipt,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('does not resolve ambiguous creatives or claim an absent adapter is ready', async () => {
    const f = await fixture(async (identity) => ({
      schemaVersion: 2,
      identity,
      apiVersion: 'test',
      sourceRevision: null,
      name: 'Ambiguous',
      creativeIds: ['a', 'b'],
      fetchedAt: new Date().toISOString(),
    }));
    await expect(f.resolve()).rejects.toMatchObject({ code: 'conflict' });
    const noProvider = createMarketingRegistration(access);
    expect(
      (await noProvider.read(f.staff.headers, f.scope)).connections[0].availability.phase,
    ).toBe('disabled');
  });
  it('validates HTTP origin/body/query and exposes no private error details', async () => {
    const f = await fixture();
    const endpoint = config.BETTER_AUTH_URL + '/api/v1/staff/ads';
    const get = createMarketingAdsHttp(f.service, config.BETTER_AUTH_URL, 'read');
    const post = createMarketingAdsHttp(f.service, config.BETTER_AUTH_URL, 'resolve');
    const h = new Headers(f.staff.headers);
    h.set('content-type', 'application/json');
    h.set('origin', config.BETTER_AUTH_URL);
    const result = await get(
      new Request(endpoint + '?' + new URLSearchParams(f.scope), { headers: h }),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect((await get(new Request(endpoint + '?actorId=a&actorId=b', { headers: h }))).status).toBe(
      400,
    );
    expect(
      (
        await post(
          new Request(endpoint, { method: 'POST', headers: h, body: JSON.stringify(f.lookup) }),
        )
      ).status,
    ).toBe(200);
    h.set('origin', 'https://wrong.example');
    expect(
      (
        await post(
          new Request(endpoint, { method: 'POST', headers: h, body: JSON.stringify(f.lookup) }),
        )
      ).status,
    ).toBe(403);
    h.set('origin', config.BETTER_AUTH_URL);
    expect(
      (await post(new Request(endpoint, { method: 'POST', headers: h, body: 'invalid' }))).status,
    ).toBe(400);
    expect(
      (await post(new Request(endpoint, { method: 'POST', headers: h, body: 'x'.repeat(9000) })))
        .status,
    ).toBe(413);
  });
});
