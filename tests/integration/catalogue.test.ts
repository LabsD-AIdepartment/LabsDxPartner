import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import {
  createCredentialIdentity,
  readCredentialConfig,
} from '@/server/modules/identity/credential-auth';
import { credentialSessionHandler } from '@/server/modules/identity/credential-session';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createPartnerAccess } from '@/server/modules/partners/access';
import { createCataloguePublisher, catalogueDigest } from '@/server/modules/content/catalogue';
import { readPresentation } from '@/server/modules/content/presentation';
import { CatalogueSnapshot, type CatalogueSnapshotValue } from '@/contracts/catalogue';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let access: ReturnType<typeof createPartnerAccess>;
let login: ReturnType<typeof credentialSessionHandler>;
const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-catalogue-test-secret-at-least-32-chars',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  login = credentialSessionHandler(sql, config, auth);
  access = createPartnerAccess(
    sql,
    principalResolver(auth, async () => {}),
  );
});
beforeEach(async () => {
  await sql`delete from portal_identity.rate_limits`;
});
afterAll(async () => {
  await sql.end();
});
async function person(staff: boolean) {
  const ctx = await auth.$context,
    username = 'catalogue_' + randomUUID().slice(0, 8);
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic catalogue actor',
      username,
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await ctx.password.hash('synthetic-catalogue-password'),
  });
  if (staff)
    await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${user.id},ARRAY['manage_partners'],true,'synthetic-catalogue-actor')`;
  const response = await login(
    new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'synthetic-catalogue-password' }),
    }),
  );
  expect(response.status).toBe(200);
  return {
    id: user.id,
    headers: new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((x) => x.split(';')[0])
        .join('; '),
    }),
  };
}
function sample(partnerId: string): CatalogueSnapshotValue {
  return {
    schema: 'partner-catalogue/1',
    mode: 'complete-snapshot',
    partnerId,
    sourceRevision: 'review-v1',
    evidenceRef: 'synthetic-catalogue-review',
    profile: {
      name: 'คุณดารา',
      role: 'Celebrity partner',
      portrait: '/media/celebrity-thumbnail.png',
      avatar: '/media/celebrity-avatar.png',
    },
    clips: [
      {
        id: 'clip-1',
        title: 'คลิปหนึ่ง',
        brand: 'Axtion',
        publishedAt: '2026-08-01T00:00:00+07:00',
        cover: '/media/clip-cover-1.jpg',
        coverPosition: '50% 50%',
        removed: false,
        sourceUrl: 'https://www.facebook.com/reel/synthetic-one',
      },
      {
        id: 'clip-2',
        title: 'คลิปสอง',
        brand: 'Tendrix',
        publishedAt: '2026-08-02T00:00:00+07:00',
        cover: null,
        coverPosition: '50% 50%',
        removed: false,
        sourceUrl: null,
      },
    ],
  };
}
async function partner() {
  const id = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values(${id},'Synthetic catalogue partner','active')`;
  return id;
}
const command = (data: CatalogueSnapshotValue, revision = '0') => ({
  partnerId: data.partnerId,
  reviewId: randomUUID(),
  expectedRevision: revision,
  expectedDigest: catalogueDigest(data),
  idempotencyKey: randomUUID(),
});

describe('reviewed partner catalogue on native PostgreSQL', () => {
  it('publishes scoped profile and clips once, archives missing IDs and preserves other partners', async () => {
    const staff = await person(true),
      viewer = await person(false),
      partnerId = await partner(),
      other = await partner();
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref) values(${randomUUID()},${partnerId},${viewer.id},'active',ARRAY['view_earnings'],'synthetic-verified')`;
    let data = sample(partnerId),
      loads = 0;
    const publish = createCataloguePublisher(access, {
      load: async () => {
        loads++;
        return data;
      },
    });
    const read = () =>
      access.withPartner(viewer.headers, partnerId, 'view_earnings', readPresentation);
    expect(await read()).toMatchObject({ revision: '0', profile: null, publishedAt: null });
    const first = command(data);
    const originalSnapshot = structuredClone(data);
    await expect(publish(viewer.headers, first)).rejects.toMatchObject({ code: 'forbidden' });
    expect(loads).toBe(0);
    const results = await Promise.all([
      publish(staff.headers, first),
      publish(staff.headers, first),
    ]);
    expect(results.map((x) => x.replayed).sort()).toEqual([false, true]);
    expect(await read()).toMatchObject({
      partnerId,
      permissionRevision: 'p1:m1',
      revision: '1',
      profile: data.profile,
    });
    expect(
      (
        await sql`select earnings::text,metrics::text,settlements::text from portal_meta.partner_changes where partner_id=${partnerId}`
      )[0],
    ).toEqual({ earnings: '1', metrics: '1', settlements: '0' });
    const otherData = sample(other);
    otherData.clips[0].title = 'Another partner clip';
    await createCataloguePublisher(access, { load: async () => otherData })(
      staff.headers,
      command(otherData),
    );
    await expect(
      access.withPartner(viewer.headers, other, 'view_earnings', readPresentation),
    ).rejects.toMatchObject({ code: 'forbidden' });
    data = {
      ...data,
      sourceRevision: 'review-v2',
      clips: [{ ...data.clips[0], title: 'ชื่อปรับปรุง', coverPosition: '60% 40%' }],
    };
    await publish(staff.headers, command(data, '1'));
    expect(
      await sql`select id,title,removed from portal_content.clips where partner_id=${partnerId} order by id`,
    ).toEqual([
      { id: 'clip-1', title: 'ชื่อปรับปรุง', removed: false },
      { id: 'clip-2', title: 'คลิปสอง', removed: true },
    ]);
    expect(
      (
        await sql`select title from portal_content.clips where partner_id=${other} and id='clip-1'`
      )[0].title,
    ).toBe('Another partner clip');
    data = { ...data, sourceRevision: 'review-v3', clips: sample(partnerId).clips };
    await publish(staff.headers, command(data, '2'));
    expect(
      (
        await sql`select details from portal_access.audit where actor_id=${staff.id} and idempotency_key=${first.idempotencyKey}`
      )[0].details,
    ).toEqual({
      reviewId: first.reviewId,
      sourceDigest: first.expectedDigest,
      snapshot: CatalogueSnapshot.parse(originalSnapshot),
    });
    expect(
      (
        await sql`select removed from portal_content.clips where partner_id=${partnerId} and id='clip-2'`
      )[0].removed,
    ).toBe(false);
    expect(
      await sql`select id from portal_statements.statements where partner_id=${partnerId}`,
    ).toHaveLength(0);
    await sql`update portal_access.memberships set status='suspended' where partner_id=${partnerId} and user_id=${viewer.id}`;
    await expect(read()).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('rejects stale, changed, foreign or invalid snapshots without replacing the accepted catalogue', async () => {
    const staff = await person(true),
      id = await partner();
    let data = sample(id);
    const publish = createCataloguePublisher(access, { load: async () => data });
    const initial = command(data);
    await publish(staff.headers, initial);
    const changed = command(data, '1');
    data = { ...data, profile: { ...data.profile, name: 'Different reviewed name' } };
    await expect(publish(staff.headers, changed)).rejects.toMatchObject({ code: 'conflict' });
    await expect(publish(staff.headers, command(data, '0'))).rejects.toMatchObject({
      code: 'conflict',
    });
    data = { ...data, partnerId: await partner() };
    await expect(
      publish(staff.headers, { ...command(data, '1'), partnerId: id }),
    ).rejects.toMatchObject({ code: 'conflict' });
    data = sample(id);
    data.clips.push(data.clips[0]);
    await expect(
      publish(staff.headers, { ...initial, idempotencyKey: randomUUID(), expectedRevision: '1' }),
    ).rejects.toThrow();
    expect(
      (
        await sql`select revision::text,profile from portal_content.catalogues where partner_id=${id}`
      )[0],
    ).toMatchObject({ revision: '1', profile: sample(id).profile });
    expect(
      (await sql`select earnings::text from portal_meta.partner_changes where partner_id=${id}`)[0]
        .earnings,
    ).toBe('1');
  });
  it('rechecks staff authority after loading and serializes competing revisions', async () => {
    const staff = await person(true),
      id = await partner(),
      data = sample(id);
    const revoked = createCataloguePublisher(access, {
      load: async () => {
        await sql`update portal_access.staff_grants set active=false where user_id=${staff.id}`;
        return data;
      },
    });
    await expect(revoked(staff.headers, command(data))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      await sql`select partner_id from portal_content.catalogues where partner_id=${id}`,
    ).toHaveLength(0);
    const next = await person(true);
    const publish = createCataloguePublisher(access, { load: async () => data });
    const results = await Promise.allSettled([
      publish(next.headers, command(data)),
      publish(next.headers, command(data)),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect(
      (await sql`select revision::text from portal_content.catalogues where partner_id=${id}`)[0]
        .revision,
    ).toBe('1');
  });
  it('does not accept monetary fields or unsafe cover and source URL values', () => {
    const data = sample('partner-one');
    for (const cover of [
      'https://foreign.test/image.jpg',
      '/media/../private/file.png',
      '/media/cover.jpg?token=private',
      '/media//cover.png',
    ])
      expect(
        CatalogueSnapshot.safeParse({ ...data, clips: [{ ...data.clips[0], cover }] }).success,
      ).toBe(false);
    for (const sourceUrl of [
      'javascript:alert(1)',
      'http://foreign.test',
      'https://user:password@foreign.test',
    ])
      expect(
        CatalogueSnapshot.safeParse({ ...data, clips: [{ ...data.clips[0], sourceUrl }] }).success,
      ).toBe(false);
    expect(
      CatalogueSnapshot.safeParse({ ...data, clips: [{ ...data.clips[0], amountMinor: '999999' }] })
        .success,
    ).toBe(false);
    expect(
      CatalogueSnapshot.safeParse({
        ...data,
        clips: [{ ...data.clips[0], coverPosition: 'url(https://foreign.test)' }],
      }).success,
    ).toBe(false);
    expect(CatalogueSnapshot.safeParse(data).success).toBe(true);
  });
});
