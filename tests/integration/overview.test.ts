import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import { celebrityPeriod } from '../../dev/financial/celebrity-period';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
import { createCredentialIdentity, readCredentialConfig } from '@/server/modules/identity/credential-auth';
import { credentialSessionHandler } from '@/server/modules/identity/credential-session';
import { principalResolver } from '@/server/modules/identity/resolve-principal';
import { createPartnerAccess } from '@/server/modules/partners/access';
import { createApprovalStore, reviewDigest } from '@/server/modules/imports/approval-store';
import { createImportRunner } from '@/server/modules/imports/run';
import { createStatementPublisher } from '@/server/modules/statements/publish';
import { createSettlementImporter, settlementDigest } from '@/server/modules/statements/settle';
import { createCataloguePublisher, catalogueDigest } from '@/server/modules/content/catalogue';
import { createOverviewHttp } from '@/server/http/overview';
import { createStatementsHttp } from '@/server/http/statements';
import { OverviewResponse } from '@/contracts/overview-http';
import { overviewHttp } from '@/features/overview/http';
import { loadOverview, defaultOverviewFilters as filters } from '@/features/overview/model';
import { ApprovedPeriodFile, ApprovalContext } from '@/server/adapters/approved-period/schema';
import { earningLineRef } from '@/server/modules/earnings/corrections';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let access: ReturnType<typeof createPartnerAccess>;
let native: ReturnType<typeof credentialSessionHandler>;
let http: ReturnType<typeof createOverviewHttp>;
const config = readCredentialConfig({ BETTER_AUTH_URL: 'https://partner.example.test', BETTER_AUTH_SECRET: 'synthetic-overview-test-secret-at-least-32-chars', DATABASE_URL: 'postgresql://127.0.0.1/unused' });
beforeAll(async () => {
  sql = await connectTestDatabase();
  auth = createCredentialIdentity(config, drizzleAdapter(drizzle(sql), { provider: 'pg', schema: authSchema, transaction: true }));
  native = credentialSessionHandler(sql, config, auth);
  access = createPartnerAccess(sql, principalResolver(auth, async () => {}));
  http = createOverviewHttp(access);
});
beforeEach(async () => { await sql`delete from portal_identity.rate_limits`; });
afterAll(async () => { await sql.end(); });
async function actor(staff = false) {
  const ctx = await auth.$context;
  const username = 'overview_' + randomUUID().slice(0, 8);
  const user = await ctx.internalAdapter.createUser({ name: 'Synthetic Overview actor', username, email: randomUUID() + '@identity.invalid', emailVerified: false }, { method: 'admin' });
  await ctx.internalAdapter.createAccount({ userId: user.id, accountId: user.id, providerId: 'credential', password: await ctx.password.hash('synthetic-overview-password') });
  if (staff) await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref) values(${user.id},ARRAY['review_imports','publish_statements','record_payments','manage_partners'],true,'synthetic-overview')`;
  const response = await native(new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', { method: 'POST', headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'synthetic-overview-password' }) }));
  expect(response.status).toBe(200);
  return { id: user.id, headers: new Headers({ cookie: response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') }) };
}
async function setup() {
  const partnerId = randomUUID(), staff = await actor(true), viewer = await actor();
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic Overview partner','active')`;
  await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref) values(${randomUUID()},${partnerId},${viewer.id},'active',ARRAY['view_earnings','view_statements'],'synthetic-contact')`;
  const sample = celebrityPeriod(partnerId);
  async function ingest(input = sample) {
    input.raw = JSON.stringify(input.file);
    input.context.fileSha256 = createHash('sha256').update(input.raw).digest('hex');
    const store = createApprovalStore(sql, access, { load: async () => input });
    const approval = await store.approve(staff.headers, { reviewId: randomUUID(), expectedDigest: reviewDigest(input.raw, input.context), idempotencyKey: randomUUID() });
    const candidate = await createImportRunner(sql, store.repository)(input.raw, approval.id, randomUUID());
    expect(candidate.state).toBe('ready');
    return { approval, candidate, publish: () => createStatementPublisher(access)(staff.headers, { partnerId, generationId: candidate.runId, approvalId: approval.id, scheduledAt: '2026-09-15T00:00:00Z', idempotencyKey: randomUUID() }) };
  }
  async function catalogue(data = celebrityCatalogue(partnerId), revision = '0') {
    return createCataloguePublisher(access, { load: async () => data })(staff.headers, { partnerId, reviewId: randomUUID(), expectedDigest: catalogueDigest(data), expectedRevision: revision, idempotencyKey: randomUUID() });
  }
  const params = { partnerId, permissionRevision: 'p1:m1', from: filters.from, toExclusive: filters.toExclusive };
  const request = (extra: Record<string,string> = {}, headers = viewer.headers) => http(new Request(config.BETTER_AUTH_URL + '/api/v1/partner/overview?' + new URLSearchParams({...params, ...extra}), { headers }));
  async function read(extra: Record<string,string> = {}) {
    const response = await request(extra);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return OverviewResponse.parse(await response.json());
  }
  return { partnerId, staff, viewer, sample, ingest, catalogue, request, read, params };
}

describe('native Overview publication and presentation snapshot', () => {
  it('does not attribute excluded records to a selected brand', async () => {
    const s = await setup(); await s.catalogue();
    const original = s.sample.file.rows[0];
    const excluded = { entitlement: { ...original.entitlement, reference: 'excluded-right' },
      sourceId: original.sourceId, sourceAccount: original.sourceAccount, sourceRevision: 'excluded-1',
      earnedAt: original.earnedAt, evidenceRef: 'excluded-evidence', disposition: 'excluded' as const,
      reasonRef: 'not-eligible', approvalRef: 'approved-exclusion' };
    s.sample.file.rows.push(excluded);
    const controls = { ...s.sample.file.sources[0].controls, rows: 7, excluded: 1 };
    s.sample.file.sources[0].controls = controls;
    s.sample.context.sources[0].controls = controls;
    s.sample.context.exclusions.push({ entitlement: excluded.entitlement, reasonRef: excluded.reasonRef, approvalRef: excluded.approvalRef });
    await (await s.ingest()).publish();
    expect((await s.read()).data.earnings.excludedCount).toBe(1);
    const filtered = await s.read({ brand: 'Axtion' });
    expect(filtered.data.earnings.excludedCount).toBeNull();
    expect(filtered.data.earnings.confirmed?.minor).toBe('1592000');
  });
  it('does not mix partner metadata or earnings when both catalogues use the same clip IDs', async () => {
    const first = await setup(), second = await setup();
    await first.catalogue();
    const otherCatalogue = celebrityCatalogue(second.partnerId);
    otherCatalogue.profile.name = 'Other partner only';
    otherCatalogue.clips.forEach(c => { c.title = 'Other partner clip'; c.brand = 'Other brand'; });
    await second.catalogue(otherCatalogue);
    await (await first.ingest()).publish();
    await (await second.ingest()).publish();
    const firstView = await first.read(), secondView = await second.read();
    expect(firstView.data.brands).not.toContain('Other brand');
    expect(secondView.data.brands).toEqual(['Other brand']);
    expect(firstView.data.earnings.confirmed?.minor).toBe('3736000');
    expect(secondView.data.earnings.confirmed?.minor).toBe('3736000');
    expect(firstView.data.earnings.topContent.every(c => c.title !== 'Other partner clip')).toBe(true);
    expect(firstView.data.earnings.generation).not.toBe(secondView.data.earnings.generation);
    expect((await first.request({ partnerId: second.partnerId })).status).toBe(403);
  });
  it('preserves amounts beyond Number precision through SQL, JSON, trend and payout', async () => {
    const s = await setup(); await s.catalogue();
    const original = s.sample.file.rows[0];
    if (original.disposition !== 'included') throw new Error('Expected included row');
    const bonus = { ...structuredClone(original), entitlement: { ...original.entitlement, reference: 'large-bonus' },
      earning: { kind: 'bonus' as const, approvalRef: 'approved-large-bonus', amountMinor: '900719925474099301' } };
    s.sample.file.rows.push(bonus);
    const controls = { rows: 7, included: 7, excluded: 0, unresolved: 0, eligibleBaseMinor: '55000000', amountMinor: '900719925477835301' };
    s.sample.file.sources[0].controls = controls;
    s.sample.context.sources[0].controls = controls;
    s.sample.context.amounts.push({ entitlement: bonus.entitlement, agreementVersion: bonus.agreementVersion,
      earnedAt: bonus.earnedAt, evidenceRef: bonus.evidenceRef, earning: bonus.earning });
    s.sample.context.attributions.push({ ...s.sample.context.attributions[0], entitlement: bonus.entitlement });
    await (await s.ingest()).publish();
    const result = await s.read();
    expect(result.data.earnings.confirmed?.minor).toBe('900719925477835301');
    expect(result.data.earnings.channelBreakdown?.other.minor).toBe('900719925474099301');
    expect(result.data.earnings.topContent[0].earned?.minor).toBe('900719925475379301');
    expect(result.data.earnings.trend.find(p => p.date === '2026-08-30')?.amount.minor).toBe('900719925475379301');
    expect(result.data.obligation.confirmedUnpaid?.minor).toBe('900719925477835301');
  });
  it('keeps partner-only earnings in the total without assigning them to a brand', async () => {
    const s = await setup(); await s.catalogue();
    const row = s.sample.file.rows[0];
    if (row.disposition !== 'included') throw new Error('Expected included row');
    row.attribution = { kind: 'partner-only' };
    s.sample.context.attributions.shift();
    await (await s.ingest()).publish();
    const all = await s.read();
    expect(all.data.earnings.confirmed?.minor).toBe('3736000');
    expect(all.data.earnings.unassignedAmount?.minor).toBe('1280000');
    expect(all.data.earnings.salesByBrand).toBeNull();
    expect(all.data.earnings.contentCount).toBe(5);
    const filtered = await s.read({ brand: 'Axtion' });
    expect(filtered.data.earnings.confirmed?.minor).toBe('312000');
    expect(filtered.data.dataState).toBe('partial');
    expect(filtered.data.reasons).toContain('ยอดที่กรองแบรนด์รวมเฉพาะรายการที่จับคู่แบรนด์แล้ว');
  });
  it('nets a published correction globally without inventing its allocation to the next payout', async () => {
    const s = await setup(); await s.catalogue();
    const first = await s.ingest(); await first.publish();
    const original = s.sample.file.rows[0];
    if (original.disposition !== 'included') throw new Error('Expected included row');
    const period = { from: '2026-09-01T00:00:00+07:00', toExclusive: '2026-09-03T00:00:00+07:00', timezone: 'Asia/Bangkok' as const };
    const row = { ...structuredClone(original), entitlement: { ...original.entitlement, reference: 'correction-1' },
      sourceRevision: 'correction-1', earnedAt: '2026-09-01T12:00:00+07:00', earning: {
        kind: 'adjustment' as const, approvalRef: 'approved-correction', amountMinor: '-200000', reasonRef: 'refund',
        originalLineRef: earningLineRef(first.candidate.runId, original.entitlement),
        correction: { originalGenerationId: first.candidate.runId, originalEntitlement: original.entitlement, revisionSequence: '1', revisedAmountMinor: '1080000' },
      } };
    const source = { ...s.sample.file.sources[0], revision: 'correction-1', asOf: '2026-09-03T12:00:00+07:00',
      controls: { rows: 1, included: 1, excluded: 0, unresolved: 0, eligibleBaseMinor: '0', amountMinor: '-200000' } };
    const file = ApprovedPeriodFile.parse({ ...s.sample.file, period, sources: [source], rows: [row] });
    const context = ApprovalContext.parse({ ...s.sample.context, period, sources: [source], groups: [],
      amounts: [{ entitlement: row.entitlement, agreementVersion: row.agreementVersion, earnedAt: row.earnedAt, evidenceRef: row.evidenceRef, earning: row.earning }],
      attributions: [{ ...s.sample.context.attributions[0], entitlement: row.entitlement }] });
    await (await s.ingest({ file, context, raw: '' })).publish();
    const result = await s.read({ toExclusive: '2026-09-03' });
    expect(result.data.earnings.confirmed?.minor).toBe('3536000');
    expect(result.data.earnings.trend.find(p => p.date === '2026-09-01')?.amount.minor).toBe('-200000');
    expect(result.data.obligation.confirmedUnpaid?.minor).toBe('3536000');
    expect(result.data.obligation.nextPayout).toBeNull();
    expect(result.data.obligation.nextPayoutReason).toContain('มีเครดิตคงเหลือ');
  });
  it('does not expose an unissued candidate; then reconciles published money, metadata and filters through HTTP/client', async () => {
    const s = await setup();
    const empty = await s.read();
    expect(empty.data.profile).toBeNull();
    expect(empty.data.earnings.confirmed).toBeNull();
    expect(empty.data.obligation.confirmedUnpaid).toBeNull();
    await s.catalogue();
    const ready = await s.ingest();
    const privateCandidate = await s.read();
    expect(privateCandidate.data.profile?.portrait).toBe('/media/celebrity-thumbnail.png');
    expect(privateCandidate.data.earnings.confirmed).toBeNull();
    expect(privateCandidate.data.earnings.topContent).toHaveLength(0);
    const issued = await ready.publish();
    const all = await s.read();
    expect(all.data.earnings.confirmed?.minor).toBe('3736000');
    expect(all.data.earnings.eligibleSales?.minor).toBe('55000000');
    expect(all.data.earnings.estimated).toBeNull();
    expect(all.data.earnings.coverage.status).toBe('complete');
    expect(all.data.earnings.channelBreakdown).toMatchObject({ organic: { minor: '2980000' }, brandAds: {minor:'756000'}, organicRatePpm:100000, brandAdsRatePpm:30000 });
    expect(all.data.earnings.trend.reduce((n,p)=>n+BigInt(p.amount.minor),0n)).toBe(3736000n);
    expect(all.data.earnings.topContent.map(c=>c.id)).toEqual(['clip-1','clip-3','clip-5']);
    expect(all.data.earnings.topContent.every(c=>c.views===null)).toBe(true);
    expect(all.data.obligation.nextPayout?.statementId).toBe(issued.id);
    expect(all.data.obligation.confirmedUnpaid?.minor).toBe('3736000');
    const axtion = await s.read({brand:'Axtion'});
    expect(axtion.data.earnings.confirmed?.minor).toBe('1592000');
    expect(axtion.data.earnings.eligibleSales?.minor).toBe('23200000');
    expect(axtion.data.obligation.confirmedUnpaid).toEqual(all.data.obligation.confirmedUnpaid);
    expect(axtion.data.brands).toEqual(['Axtion','Melura','Rusiren','Tendrix','Zenova']);
    expect((await s.request({generation:privateCandidate.data.earnings.generation})).status).toBe(409);
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.cache).toBe('no-store'); expect(init?.credentials).toBe('same-origin');
      return http(new Request(config.BETTER_AUTH_URL+url,{...init,headers:s.viewer.headers}));
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const view = await loadOverview(overviewHttp, { scope: {userId:s.viewer.id,partnerId:s.partnerId,permissionRevision:'p1:m1'}, filters: {...filters,brand:'Axtion'}, signal:new AbortController().signal });
      expect(view.earnings.confirmed?.minor).toBe('1592000');
      expect(view.profile?.portrait).toBe('/media/celebrity-thumbnail.png');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps known zero, uncovered dates and partial coverage separate from global unpaid', async () => {
    const s = await setup(); await s.catalogue(); await (await s.ingest()).publish();
    const july = await s.read({toExclusive:'2026-08-01'});
    expect(july.data.earnings.confirmed?.minor).toBe('0');
    expect(july.data.earnings.coverage.status).toBe('complete');
    const outside = await s.read({from:'2026-06-01',toExclusive:'2026-07-01'});
    expect(outside.data.earnings.confirmed).toBeNull();
    expect(outside.data.obligation.confirmedUnpaid?.minor).toBe('3736000');
    expect(outside.data.profile).not.toBeNull();
    const partial = await s.read({toExclusive:'2026-10-01'});
    expect(partial.data.earnings.coverage.status).toBe('partial');
    expect(partial.data.earnings.confirmed?.minor).toBe('3736000');
    expect(partial.data.dataState).toBe('partial');
    const narrow = await s.read({from:'2026-08-27',toExclusive:'2026-08-30'});
    expect(narrow.data.earnings.confirmed?.minor).toBe('312000');
  });
  it('preserves total when clip metadata is missing and changes generation after a reviewed catalogue update', async () => {
    const s = await setup();
    const catalog = celebrityCatalogue(s.partnerId); catalog.clips = catalog.clips.filter(c=>c.id!=='clip-1');
    await s.catalogue(catalog); await (await s.ingest()).publish();
    const missing = await s.read();
    expect(missing.data.earnings.confirmed?.minor).toBe('3736000');
    expect(missing.data.earnings.unassignedAmount?.minor).toBe('0');
    expect(missing.data.earnings.salesByBrand).toBeNull();
    expect(missing.data.earnings.topContent.map(c=>c.id)).toEqual(['clip-3','clip-5']);
    expect(missing.data.dataState).toBe('partial');
    expect((await s.read({brand:'Axtion'})).data.earnings.confirmed?.minor).toBe('312000');
    await s.catalogue(celebrityCatalogue(s.partnerId),'1');
    const complete = await s.read();
    expect(complete.catalogueRevision).toBe('2');
    expect(complete.data.earnings.confirmed).toEqual(missing.data.earnings.confirmed);
    expect(complete.data.earnings.generation).not.toBe(missing.data.earnings.generation);
    expect(complete.earningsRevision).not.toBe(missing.earningsRevision);
    expect((await s.request({generation:missing.data.earnings.generation})).status).toBe(409);
  });
  it('denies foreign/currently suspended scope and hides payout without statement capability', async () => {
    const s = await setup(); await s.catalogue(); await (await s.ingest()).publish();
    expect((await s.request({},new Headers())).status).toBe(401);
    expect((await s.request({partnerId:randomUUID()})).status).toBe(403);
    expect((await s.request({permissionRevision:'p1:m0'})).status).toBe(403);
    expect((await s.request({userId:s.viewer.id})).status).toBe(400);
    expect((await s.request({from:'2020-01-01'})).status).toBe(400);
    const duplicate = new Request(config.BETTER_AUTH_URL+'/api/v1/partner/overview?'+new URLSearchParams(s.params)+'&partnerId='+s.partnerId,{headers:s.viewer.headers});
    expect((await http(duplicate)).status).toBe(400);
    await sql`update portal_access.memberships set capabilities=ARRAY['view_earnings'],permission_revision=2 where partner_id=${s.partnerId} and user_id=${s.viewer.id}`;
    const restricted = await s.read({permissionRevision:'p1:m2'});
    expect(restricted.data.earnings.confirmed?.minor).toBe('3736000');
    expect(restricted.data.obligation.confirmedUnpaid).toBeNull();
    expect(restricted.data.obligation.nextPayout).toBeNull();
    expect(restricted.data.obligation.nextPayoutReason).toContain('ไม่ได้รับสิทธิ์');
    await sql`update portal_access.memberships set status='suspended' where partner_id=${s.partnerId} and user_id=${s.viewer.id}`;
    const denied = await s.request({permissionRevision:'p1:m2'});
    expect(denied.status).toBe(403); expect(await denied.text()).not.toContain('3736000');
  });
  it('updates global balance after approved payment without changing the earnings generation', async () => {
    const s=await setup(); await s.catalogue(); const issued=await (await s.ingest()).publish();
    const before=await s.read();
    const record={kind:'payment',partnerId:s.partnerId,source:{authority:'synthetic-finance',account:'synthetic-overview',reference:randomUUID()},evidenceRef:'synthetic-payment',occurredAt:'2026-09-01T12:00:00Z',cashMinor:'1148400',withholdingMinor:'35600',otherMinor:'0',allocations:[{statementId:issued.id,cashMinor:'1148400',withholdingMinor:'35600',otherMinor:'0',otherReasonRef:null}]};
    await createSettlementImporter(access,{load:async()=>record})(s.staff.headers,{sourceRecordId:randomUUID(),expectedDigest:settlementDigest(record),idempotencyKey:randomUUID()});
    const after=await s.read();
    expect(after.data.obligation.confirmedUnpaid?.minor).toBe('2552000');
    expect(after.data.obligation.nextPayout?.amount.minor).toBe('2552000');
    expect(after.data.earnings).toEqual(before.data.earnings);
    expect(after.settlementsRevision).not.toBe(before.settlementsRevision);
    const statements=await createStatementsHttp(access)(new Request(config.BETTER_AUTH_URL+'/api/v1/partner/statements?'+new URLSearchParams({partnerId:s.partnerId,permissionRevision:'p1:m1'}),{headers:s.viewer.headers}));
    expect((await statements.json()).confirmedUnpaid.minor).toBe('2552000');
  });
});
