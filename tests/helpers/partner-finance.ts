import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import { celebrityPeriod } from '../../dev/financial/celebrity-period';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
import {
  createCredentialIdentity,
  readCredentialConfig,
} from '@/server/modules/identity/credential-auth';
import { credentialSessionHandler } from '@/server/modules/identity/credential-session';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createPartnerAccess } from '@/server/modules/partners/access';
import { createApprovalStore, reviewDigest } from '@/server/modules/imports/approval-store';
import { createImportRunner } from '@/server/modules/imports/run';
import { createStatementPublisher } from '@/server/modules/statements/publish';
import { createCataloguePublisher, catalogueDigest } from '@/server/modules/content/catalogue';
import { createOverviewHttp } from '@/server/http/overview';
import { OverviewResponse } from '@/contracts/overview-http';
import { defaultOverviewFilters as filters } from '@/features/overview/model';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let access: ReturnType<typeof createPartnerAccess>;
let native: ReturnType<typeof credentialSessionHandler>;
let http: ReturnType<typeof createOverviewHttp>;
const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-overview-test-secret-at-least-32-chars',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }),
  );
  native = credentialSessionHandler(sql, config, auth);
  access = createPartnerAccess(
    sql,
    principalResolver(auth, async () => {}),
  );
  http = createOverviewHttp(access);
});
beforeEach(async () => {
  await sql`delete from portal_identity.rate_limits`;
});
afterAll(async () => {
  await sql.end();
});
async function actor(staff = false) {
  const ctx = await auth.$context;
  const username = 'overview_' + randomUUID().slice(0, 8);
  const user = await ctx.internalAdapter.createUser(
    {
      name: 'Synthetic Overview actor',
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
    password: await ctx.password.hash('synthetic-overview-password'),
  });
  if (staff)
    await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${user.id},ARRAY['review_imports','publish_statements','record_payments','manage_partners'],true,'synthetic-overview')`;
  const response = await native(
    new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'synthetic-overview-password' }),
    }),
  );
  expect(response.status).toBe(200);
  return {
    id: user.id,
    headers: new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    }),
  };
}
async function setup() {
  const partnerId = randomUUID(),
    staff = await actor(true),
    viewer = await actor();
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic Overview partner','active')`;
  await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref) values(${randomUUID()},${partnerId},${viewer.id},'active',ARRAY['view_earnings','view_content','view_statements'],'synthetic-contact')`;
  const sample = celebrityPeriod(partnerId);
  async function ingest(input = sample) {
    input.raw = JSON.stringify(input.file);
    input.context.fileSha256 = createHash('sha256').update(input.raw).digest('hex');
    const store = createApprovalStore(sql, access, { load: async () => input });
    const approval = await store.approve(staff.headers, {
      reviewId: randomUUID(),
      expectedDigest: reviewDigest(input.raw, input.context),
      idempotencyKey: randomUUID(),
    });
    const candidate = await createImportRunner(sql, store.repository)(
      input.raw,
      approval.id,
      randomUUID(),
    );
    expect(candidate.state).toBe('ready');
    return {
      approval,
      candidate,
      publish: () =>
        createStatementPublisher(access)(staff.headers, {
          partnerId,
          generationId: candidate.runId,
          approvalId: approval.id,
          scheduledAt: '2026-09-15T00:00:00Z',
          idempotencyKey: randomUUID(),
        }),
    };
  }
  async function catalogue(data = celebrityCatalogue(partnerId), revision = '0') {
    return createCataloguePublisher(access, { load: async () => data })(staff.headers, {
      partnerId,
      reviewId: randomUUID(),
      expectedDigest: catalogueDigest(data),
      expectedRevision: revision,
      idempotencyKey: randomUUID(),
    });
  }
  const params = {
    partnerId,
    permissionRevision: 'p1:m1',
    from: filters.from,
    toExclusive: filters.toExclusive,
  };
  const request = (extra: Record<string, string> = {}, headers = viewer.headers) =>
    http(
      new Request(
        config.BETTER_AUTH_URL +
          '/api/v1/partner/overview?' +
          new URLSearchParams({ ...params, ...extra }),
        { headers },
      ),
    );
  async function read(extra: Record<string, string> = {}) {
    const response = await request(extra);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return OverviewResponse.parse(await response.json());
  }
  return { partnerId, staff, viewer, sample, ingest, catalogue, request, read, params };
}

export { setup, sql, access, config };
