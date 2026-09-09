import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { authSchema } from '../../db/schema/identity';
import { celebrityPeriod } from '../../dev/financial/celebrity-period';
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
import { createSettlementImporter, settlementDigest } from '@/server/modules/statements/settle';
import { SourceSettlement } from '@/server/modules/statements/settlement-source';
import { earningLineRef } from '@/server/modules/earnings/corrections';
import { ApprovedPeriodFile, ApprovalContext } from '@/server/adapters/approved-period/schema';
import { createStatementExportHttp } from '@/server/http/statement-export';
import { createStatementsHttp } from '@/server/http/statements';
import { createChangesHttp } from '@/server/http/changes';
import { Changes } from '@/contracts/changes';
import { advanceRevisions } from '@/server/platform/db/revisions';
import {
  loadTransactions,
  type TransactionTransport,
  type DetailValue,
} from '@/features/transactions/model';
import { StatementDetailResponse, StatementListResponse } from '@/contracts/statements';

let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
let auth: ReturnType<typeof createCredentialIdentity>;
let access: ReturnType<typeof createPartnerAccess>;
let native: ReturnType<typeof credentialSessionHandler>;
const config = readCredentialConfig({
  BETTER_AUTH_URL: 'https://partner.example.test',
  BETTER_AUTH_SECRET: 'synthetic-statement-test-secret-at-least-32-chars',
  DATABASE_URL: 'postgresql://127.0.0.1/unused',
});
beforeAll(async () => {
  sql = await connectTestDatabase();
  await sql`delete from portal_identity.rate_limits`;
  auth = createCredentialIdentity(
    config,
    drizzleAdapter(drizzle(sql), {
      provider: 'pg',
      schema: authSchema,
      transaction: true,
    }),
  );
  native = credentialSessionHandler(sql, config, auth);
  access = createPartnerAccess(
    sql,
    principalResolver(auth, async () => {}),
  );
});
afterAll(async () => {
  await sql.end();
});
beforeEach(async () => {
  // Each case starts a distinct synthetic staff journey; do not share login throttle history.
  await sql`delete from portal_identity.rate_limits`;
});
async function actor(capabilities: string[]) {
  const context = await auth.$context;
  const username = 'finance_' + randomUUID().slice(0, 8);
  const user = await context.internalAdapter.createUser(
    {
      name: 'Synthetic finance staff',
      username,
      email: randomUUID() + '@identity.invalid',
      emailVerified: false,
    },
    { method: 'admin' },
  );
  await context.internalAdapter.createAccount({
    userId: user.id,
    accountId: user.id,
    providerId: 'credential',
    password: await context.password.hash('synthetic-statement-password'),
  });
  await sql`insert into portal_access.staff_grants(user_id,capabilities,active,provision_ref)
    values(${user.id},${capabilities},true,'synthetic-statements')`;
  const response = await native(
    new Request(config.BETTER_AUTH_URL + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'synthetic-statement-password' }),
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
  const partnerId = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic celebrity','active')`;
  const sample = celebrityPeriod(partnerId);
  const reviewer = await actor(['review_imports']);
  const publisher = await actor(['publish_statements']);
  let reads = 0;
  const approvals = createApprovalStore(sql, access, {
    load: async () => {
      reads++;
      return sample;
    },
  });
  const approveInput = {
    reviewId: randomUUID(),
    expectedDigest: reviewDigest(sample.raw, sample.context),
    idempotencyKey: randomUUID(),
  };
  const run = createImportRunner(sql, approvals.repository);
  const publish = createStatementPublisher(access);
  async function ready() {
    const approval = await approvals.approve(reviewer.headers, approveInput);
    const candidate = await run(sample.raw, approval.id, randomUUID());
    expect(candidate.state).toBe('ready');
    const command = {
      partnerId,
      generationId: candidate.runId,
      approvalId: approval.id,
      scheduledAt: '2026-09-15T00:00:00.000Z',
      idempotencyKey: randomUUID(),
    };
    return { approval, candidate, command };
  }
  return {
    partnerId,
    sample,
    reviewer,
    publisher,
    approvals,
    approveInput,
    run,
    publish,
    ready,
    reads: () => reads,
  };
}
function correctionSample(
  root: ReturnType<typeof celebrityPeriod>,
  generation: string,
  sequence: string,
  delta: string,
  revised: string,
  from = '2026-09-01',
  to = '2026-09-03',
) {
  const row = structuredClone(root.file.rows[0]);
  if (row.disposition !== 'included') throw new Error('Expected included original');
  const original = structuredClone(row.entitlement);
  row.entitlement = { ...original, reference: 'correction-' + sequence };
  row.sourceRevision = 'correction-' + sequence;
  row.earnedAt = from + 'T12:00:00+07:00';
  row.earning = {
    kind: 'adjustment',
    approvalRef: 'synthetic-correction-' + sequence,
    amountMinor: delta,
    reasonRef: 'synthetic-cumulative-refund',
    originalLineRef: earningLineRef(generation, original),
    correction: {
      originalGenerationId: generation,
      originalEntitlement: original,
      revisionSequence: sequence,
      revisedAmountMinor: revised,
    },
  };
  const period = {
    from: from + 'T00:00:00+07:00',
    toExclusive: to + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  const source = {
    ...root.file.sources[0],
    revision: 'correction-' + sequence,
    asOf: to + 'T12:00:00+07:00',
    controls: {
      rows: 1,
      included: 1,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '0',
      amountMinor: delta,
    },
  };
  const file = ApprovedPeriodFile.parse({ ...root.file, period, sources: [source], rows: [row] });
  const raw = JSON.stringify(file);
  const context = ApprovalContext.parse({
    ...root.context,
    fileSha256: createHash('sha256').update(raw).digest('hex'),
    period,
    sources: [source],
    groups: [],
    amounts: [
      {
        entitlement: row.entitlement,
        agreementVersion: row.agreementVersion,
        earnedAt: row.earnedAt,
        evidenceRef: row.evidenceRef,
        earning: row.earning,
      },
    ],
    attributions: root.context.attributions
      .slice(0, 1)
      .map((a) => ({ ...a, entitlement: row.entitlement })),
  });
  return { file, raw, context };
}
describe('native authorized approval to immutable statement on PostgreSQL', () => {
  it('exposes isolated metadata and advances only committed owner changes, once per outcome', async () => {
    const s = await setup();
    const member = await actor(['record_payments']);
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values(${randomUUID()},${s.partnerId},${member.id},'active',ARRAY['view_statements'],'synthetic-verified')`;
    const http = createChangesHttp(access);
    const url = new URL(config.BETTER_AUTH_URL + '/api/v1/partner/changes');
    url.search = new URLSearchParams({
      partnerId: s.partnerId,
      permissionRevision: 'p1:m1',
      capability: 'view_statements',
    }).toString();
    const response = () => http(new Request(url, { headers: member.headers }));
    const read = async () => {
      const r = await response();
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('private, no-store');
      return Changes.parse(await r.json());
    };
    const empty = await read();
    expect(empty).toMatchObject({
      earningsRevision: '0',
      settlementsRevision: '0',
      metricsRevision: '0',
      noticesRevision: '0',
      sources: [],
    });
    const ready = await s.ready();
    expect(await read()).toMatchObject({ earningsRevision: '1', settlementsRevision: '0' });
    const issued = await s.publish(s.publisher.headers, ready.command);
    await s.publish(s.publisher.headers, ready.command);
    expect(await read()).toMatchObject({ earningsRevision: '2', settlementsRevision: '1' });
    const payment = {
      kind: 'payment',
      partnerId: s.partnerId,
      source: { authority: 'synthetic-finance', account: 'payor-1', reference: randomUUID() },
      evidenceRef: 'synthetic-payment-evidence',
      occurredAt: '2026-09-01T12:00:00.000Z',
      cashMinor: '10000',
      withholdingMinor: '0',
      otherMinor: '0',
      allocations: [
        {
          statementId: issued.id,
          cashMinor: '10000',
          withholdingMinor: '0',
          otherMinor: '0',
          otherReasonRef: null,
        },
      ],
    };
    const settle = createSettlementImporter(access, { load: async () => payment });
    const command = {
      sourceRecordId: randomUUID(),
      expectedDigest: settlementDigest(payment),
      idempotencyKey: randomUUID(),
    };
    await Promise.all([settle(member.headers, command), settle(member.headers, command)]);
    expect(await read()).toMatchObject({
      earningsRevision: '2',
      settlementsRevision: '2',
      metricsRevision: '0',
      noticesRevision: '0',
    });
    await expect(
      sql.begin(async (tx) => {
        await advanceRevisions(tx, s.partnerId, ['earnings', 'metrics', 'notices']);
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow('synthetic rollback');
    expect(await read()).toMatchObject({
      earningsRevision: '2',
      metricsRevision: '0',
      noticesRevision: '0',
    });
    // Counter storage supports future independent owners, without claiming their services exist.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        sql.begin(async (tx) => {
          await advanceRevisions(tx, s.partnerId, ['metrics']);
        }),
      ),
    );
    await sql.begin(async (tx) => {
      await advanceRevisions(tx, s.partnerId, ['notices']);
    });
    expect(await read()).toMatchObject({
      earningsRevision: '2',
      settlementsRevision: '2',
      metricsRevision: '5',
      noticesRevision: '1',
    });
    expect((await http(new Request(url))).status).toBe(401);
    url.searchParams.set('partnerId', randomUUID());
    expect((await response()).status).toBe(403);
    url.searchParams.set('partnerId', s.partnerId);
    url.searchParams.set('capability', 'view_earnings');
    expect((await response()).status).toBe(403);
    url.searchParams.set('capability', 'view_statements');
    url.searchParams.set('permissionRevision', 'p1:m0');
    expect((await response()).status).toBe(403);
    url.searchParams.set('permissionRevision', 'p1:m1');
    url.searchParams.append('partnerId', s.partnerId);
    expect((await response()).status).toBe(400);
    url.searchParams.set('partnerId', s.partnerId);
    url.searchParams.set('userId', member.id);
    expect((await response()).status).toBe(400);
    url.searchParams.delete('userId');
    await sql`update portal_access.memberships set status='suspended' where user_id=${member.id} and partner_id=${s.partnerId}`;
    expect((await response()).status).toBe(403);
  });
  it('serves issued lines through native HTTP to the frontend model with complete microsecond cursors', async () => {
    const s = await setup();
    s.sample.file.rows.forEach((row, i) => {
      row.earnedAt = `2026-08-20T05:00:00.00000${i + 1}Z`;
    });
    s.sample.raw = JSON.stringify(s.sample.file);
    s.sample.context.fileSha256 = createHash('sha256').update(s.sample.raw).digest('hex');
    s.approveInput.expectedDigest = reviewDigest(s.sample.raw, s.sample.context);
    const ready = await s.ready();
    const issued = await s.publish(s.publisher.headers, ready.command);
    const member = await actor(['manage_partners']);
    const http = createStatementsHttp(access);
    const url = new URL(config.BETTER_AUTH_URL + '/api/v1/partner/statements');
    url.searchParams.set('partnerId', s.partnerId);
    url.searchParams.set('permissionRevision', 'p1:m1');
    const request = () => new Request(url, { headers: member.headers });
    expect((await http(new Request(url))).status).toBe(401);
    expect((await http(request())).status).toBe(403);
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values(${randomUUID()},${s.partnerId},${member.id},'active',ARRAY['view_statements'],'synthetic-verified')`;
    const first = await http(request());
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    const list = StatementListResponse.parse(await first.json());
    expect(list.confirmedUnpaid.minor).toBe('3736000');
    expect(list.data.items.map((x) => x.id)).toEqual([issued.id]);
    const scope = { userId: member.id, partnerId: s.partnerId, permissionRevision: 'p1:m1' };
    const transport: TransactionTransport = async (r) => {
      const page = new URL(url);
      page.searchParams.set('limit', '2');
      for (const key of [
        'cursor',
        'lineCursor',
        'settlementCursor',
        'version',
        'revision',
      ] as const)
        if (r[key]) page.searchParams.set(key, r[key]);
      const response = await http(new Request(page, { headers: member.headers }), r.statementId);
      expect(response.status).toBe(200);
      return response.json();
    };
    let next: string | null = null;
    const ids: string[] = [],
      amounts: bigint[] = [];
    do {
      const detail: DetailValue = await loadTransactions(transport, {
        scope,
        resource: 'detail',
        statementId: issued.id,
        version: issued.version,
        revision: list.settlementsRevision,
        lineCursor: next,
        signal: new AbortController().signal,
      });
      expect(detail.data.statement.newEarnings.minor).toBe('3736000');
      expect(detail.data.lines.totalCount).toBe(6);
      expect(detail.data.documents).toEqual([
        {
          id: 'csv:' + issued.id,
          statementId: issued.id,
          name: 'ใบสรุปรายได้ CSV',
          kind: 'statement',
        },
      ]);
      ids.push(...detail.data.lines.items.map((x) => x.id));
      amounts.push(...detail.data.lines.items.map((x) => BigInt(x.amount.minor)));
      next = detail.data.lines.nextCursor;
      if (next)
        expect(JSON.parse(Buffer.from(next, 'base64url').toString()).at).toMatch(/\.00000[1-6]Z$/);
      expect(ids.length).toBeLessThanOrEqual(6);
    } while (next);
    expect(new Set(ids).size).toBe(6);
    expect(amounts.reduce((n, a) => n + a, 0n)).toBe(3736000n);
    const full = await loadTransactions(async () => (await http(request(), issued.id)).json(), {
      scope,
      resource: 'detail',
      statementId: issued.id,
      signal: new AbortController().signal,
    });
    expect(full.data.lines.items.map((x) => x.id)).toEqual(ids);
    url.searchParams.set('version', randomUUID());
    expect((await http(request(), issued.id)).status).toBe(409);
    url.searchParams.delete('version');
    url.searchParams.set('lineCursor', 'invalid');
    expect((await http(request(), issued.id)).status).toBe(400);
    url.searchParams.delete('lineCursor');
    for (const limit of ['0', '101', '1.5']) {
      url.searchParams.set('limit', limit);
      expect((await http(request())).status).toBe(400);
    }
    url.searchParams.delete('limit');
    expect((await http(request(), randomUUID())).status).toBe(403);
    await sql`update portal_access.memberships set permission_revision=permission_revision+1 where user_id=${member.id} and partner_id=${s.partnerId}`;
    expect((await http(request())).status).toBe(409);
    url.searchParams.set('permissionRevision', 'p1:m2');
    expect((await http(request())).status).toBe(200);
    await sql`update portal_access.memberships set status='suspended' where user_id=${member.id} and partner_id=${s.partnerId}`;
    expect((await http(request(), issued.id)).status).toBe(403);
  });
  it('keeps signed global credits across status filters and rejects stale cursors after payment and reversal', async () => {
    const s = await setup(),
      root = structuredClone(s.sample);
    const ready = await s.ready();
    const issued = await s.publish(s.publisher.headers, ready.command);
    Object.assign(
      s.sample,
      correctionSample(root, ready.candidate.runId, '1', '-100000', '1180000'),
    );
    const approval = await s.approvals.approve(s.reviewer.headers, {
      reviewId: randomUUID(),
      expectedDigest: reviewDigest(s.sample.raw, s.sample.context),
      idempotencyKey: randomUUID(),
    });
    const correction = await s.run(s.sample.raw, approval.id, randomUUID());
    const credit = await s.publish(s.publisher.headers, {
      ...ready.command,
      generationId: correction.runId,
      approvalId: approval.id,
      idempotencyKey: randomUUID(),
    });
    const member = await actor(['record_payments']);
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values(${randomUUID()},${s.partnerId},${member.id},'active',ARRAY['view_statements'],'synthetic-verified')`;
    const http = createStatementsHttp(access);
    const url = new URL(config.BETTER_AUTH_URL + '/api/v1/partner/statements');
    url.searchParams.set('partnerId', s.partnerId);
    url.searchParams.set('permissionRevision', 'p1:m1');
    url.searchParams.set('limit', '1');
    const read = (id?: string) => http(new Request(url, { headers: member.headers }), id);
    const first = StatementListResponse.parse(await (await read()).json());
    expect(first.confirmedUnpaid.minor).toBe('3636000');
    expect(first.data.items[0]).toMatchObject({
      id: credit.id,
      status: 'credit',
      adjustments: { minor: '-100000' },
    });
    expect(first.data.nextCursor).not.toBeNull();
    url.searchParams.set('cursor', first.data.nextCursor!);
    const second = StatementListResponse.parse(await (await read()).json());
    expect(second.data.items.map((x) => x.id)).toEqual([issued.id]);
    expect(second.data.nextCursor).toBeNull();
    url.searchParams.delete('cursor');
    url.searchParams.set('status', 'pending');
    const pending = StatementListResponse.parse(await (await read()).json());
    expect(pending.confirmedUnpaid.minor).toBe('3636000');
    expect(pending.data.items.map((x) => x.id)).toEqual([issued.id]);
    url.searchParams.delete('status');
    const payment = {
      kind: 'payment' as const,
      partnerId: s.partnerId,
      source: { authority: 'synthetic-finance', account: 'payor-1', reference: randomUUID() },
      evidenceRef: 'synthetic-payment-evidence',
      occurredAt: '2026-09-01T12:00:00.000Z',
      cashMinor: '580000',
      withholdingMinor: '20000',
      otherMinor: '0',
      allocations: [
        {
          statementId: issued.id,
          cashMinor: '580000',
          withholdingMinor: '15000',
          otherMinor: '5000',
          otherReasonRef: 'synthetic-offset-evidence',
        },
      ],
    };
    payment.withholdingMinor = '15000';
    payment.otherMinor = '5000';
    let source: unknown = payment;
    const settle = createSettlementImporter(access, { load: async () => source });
    const importPayment = () =>
      settle(member.headers, {
        sourceRecordId: randomUUID(),
        expectedDigest: settlementDigest(source),
        idempotencyKey: randomUUID(),
      });
    const paid = await importPayment();
    url.searchParams.set('cursor', first.data.nextCursor!);
    expect((await read()).status).toBe(409);
    url.searchParams.delete('cursor');
    const partial = StatementDetailResponse.parse(await (await read(issued.id)).json());
    expect(partial.data.statement).toMatchObject({
      status: 'part-paid',
      settled: { minor: '600000' },
      closing: { minor: '3136000' },
    });
    expect(partial.data.settlements.items[0]).toMatchObject({
      kind: 'payment',
      cash: { minor: '580000' },
      withholding: { minor: '15000' },
      other: { minor: '5000' },
      otherReasonRef: 'synthetic-offset-evidence',
    });
    source = {
      kind: 'reversal',
      partnerId: s.partnerId,
      source: { ...payment.source, reference: randomUUID() },
      original: payment.source,
      reasonRef: 'synthetic-bank-return',
      evidenceRef: 'synthetic-return-evidence',
      occurredAt: '2026-09-02T12:00:00.000Z',
    };
    await importPayment();
    url.searchParams.set('revision', partial.settlementsRevision);
    expect((await read(issued.id)).status).toBe(409);
    url.searchParams.delete('revision');
    const reversed = StatementDetailResponse.parse(await (await read(issued.id)).json());
    expect(reversed.data.statement).toMatchObject({ status: 'pending', settled: { minor: '0' } });
    expect(reversed.data.settlements.items[0]).toMatchObject({
      kind: 'reversal',
      originalSettlementId: paid.id,
      reasonRef: 'synthetic-bank-return',
      obligationSettled: { minor: '-600000' },
    });
    expect(reversed.data.settlements.nextCursor).not.toBeNull();
    url.searchParams.set('settlementCursor', reversed.data.settlements.nextCursor!);
    const older = StatementDetailResponse.parse(await (await read(issued.id)).json());
    expect(older.data.settlements.items.map((x) => x.id)).toEqual([paid.id]);
    expect(older.data.settlements.nextCursor).toBeNull();
    url.searchParams.delete('settlementCursor');
    url.searchParams.delete('limit');
    const transport: TransactionTransport = async (r) => (await read(r.statementId)).json();
    const scope = { userId: member.id, partnerId: s.partnerId, permissionRevision: 'p1:m1' };
    const final = await loadTransactions(transport, {
      scope,
      resource: 'detail',
      statementId: issued.id,
      signal: new AbortController().signal,
    });
    expect(final.data.settlements.items).toHaveLength(2);
    const creditDetail = await loadTransactions(transport, {
      scope,
      resource: 'detail',
      statementId: credit.id,
      signal: new AbortController().signal,
    });
    expect(creditDetail.data.lines.items[0].amount.minor).toBe('-100000');
  });
  it('exports only a currently authorized partner and exact frozen version, with private response headers', async () => {
    const s = await setup();
    const ready = await s.ready();
    const statement = await s.publish(s.publisher.headers, ready.command);
    const member = await actor(['manage_partners']);
    const exportFile = createStatementExportHttp(access);
    const url = new URL(
      config.BETTER_AUTH_URL + '/api/v1/partner/statements/' + statement.id + '/export',
    );
    url.searchParams.set('partnerId', s.partnerId);
    url.searchParams.set('version', statement.version);
    const request = () => new Request(url, { headers: member.headers });
    expect((await exportFile(request(), statement.id)).status).toBe(403);
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values(${randomUUID()},${s.partnerId},${member.id},'active',ARRAY['view_statements'],'synthetic-verified')`;
    const exported = await exportFile(request(), statement.id);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('cache-control')).toBe('private, no-store');
    expect(exported.headers.get('content-disposition')).toBe(
      'attachment; filename="statement-' + statement.id + '.csv"',
    );
    const csv = await exported.text();
    expect(csv).toContain(',37360.00,0.00,0\r\n');
    expect(csv.match(/"included","commission"/g)).toHaveLength(6);
    expect(csv).toContain(',128000.00,100000,12800.00,');
    expect(csv).not.toContain('demo-right-clip');
    url.searchParams.set('version', randomUUID());
    expect((await exportFile(request(), statement.id)).status).toBe(409);
    url.searchParams.set('version', statement.version);
    url.searchParams.set('partnerId', randomUUID());
    expect((await exportFile(request(), statement.id)).status).toBe(403);
    url.searchParams.set('partnerId', s.partnerId);
    await sql`update portal_access.memberships set status='suspended' where user_id=${member.id} and partner_id=${s.partnerId}`;
    expect((await exportFile(request(), statement.id)).status).toBe(403);
  });
  it('books only each cumulative correction delta and carries negative credit into the payment cap', async () => {
    const s = await setup(),
      root = structuredClone(s.sample);
    const original = await s.ready();
    const first = await s.publish(s.publisher.headers, original.command);
    async function importCorrection(sample: ReturnType<typeof correctionSample>) {
      Object.assign(s.sample, sample);
      const approval = await s.approvals.approve(s.reviewer.headers, {
        reviewId: randomUUID(),
        expectedDigest: reviewDigest(sample.raw, sample.context),
        idempotencyKey: randomUUID(),
      });
      const candidate = await s.run(sample.raw, approval.id, randomUUID());
      return {
        ...original.command,
        generationId: candidate.runId,
        approvalId: approval.id,
        idempotencyKey: randomUUID(),
      };
    }
    const one = await importCorrection(
      correctionSample(root, original.candidate.runId, '1', '-100000', '1180000'),
    );
    await s.publish(s.publisher.headers, one);
    await expect(
      importCorrection(
        correctionSample(
          root,
          original.candidate.runId,
          '2',
          '-150000',
          '1130000',
          '2026-09-03',
          '2026-09-05',
        ),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const two = await importCorrection(
      correctionSample(
        root,
        original.candidate.runId,
        '2',
        '-50000',
        '1130000',
        '2026-09-03',
        '2026-09-05',
      ),
    );
    await s.publish(s.publisher.headers, two);
    await expect(
      importCorrection(
        correctionSample(
          root,
          original.candidate.runId,
          '1',
          '-100000',
          '1180000',
          '2026-09-05',
          '2026-09-07',
        ),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const statements =
      await sql`select new_earnings_minor::text as earnings,adjustments_minor::text as adjustments
      from portal_statements.statements where partner_id=${s.partnerId} order by period_from`;
    expect(statements).toEqual([
      { earnings: '3736000', adjustments: '0' },
      { earnings: '0', adjustments: '-100000' },
      { earnings: '0', adjustments: '-50000' },
    ]);
    const [history] =
      await sql`select count(*)::int as count,sum(revised_amount_minor-prior_amount_minor)::text as delta
      from portal_imports.correction_links l join portal_statements.statements s on s.generation_id=l.generation_id where s.partner_id=${s.partnerId}`;
    expect(history).toEqual({ count: 2, delta: '-150000' });
    const finance = await actor(['record_payments']);
    let record = {
      kind: 'payment' as const,
      partnerId: s.partnerId,
      source: { authority: 'synthetic-finance', account: 'payor-1', reference: randomUUID() },
      evidenceRef: 'synthetic-net-of-credit',
      occurredAt: '2026-09-08T12:00:00.000Z',
      cashMinor: '3736000',
      withholdingMinor: '0',
      otherMinor: '0',
      allocations: [
        {
          statementId: first.id,
          cashMinor: '3736000',
          withholdingMinor: '0',
          otherMinor: '0',
          otherReasonRef: null,
        },
      ],
    };
    const settle = createSettlementImporter(access, { load: async () => record });
    const command = () => ({
      sourceRecordId: 'synthetic-credit-payment',
      expectedDigest: settlementDigest(record),
      idempotencyKey: randomUUID(),
    });
    await expect(settle(finance.headers, command())).rejects.toMatchObject({ code: 'conflict' });
    record = {
      ...record,
      cashMinor: '3586000',
      allocations: [{ ...record.allocations[0], cashMinor: '3586000' }],
    };
    expect(await settle(finance.headers, command())).toMatchObject({ replayed: false });
    record = {
      ...record,
      source: { ...record.source, reference: randomUUID() },
      cashMinor: '1',
      allocations: [{ ...record.allocations[0], cashMinor: '1' }],
    };
    await expect(settle(finance.headers, command())).rejects.toMatchObject({ code: 'conflict' });
  });
  it('requires an issued original in scope and refuses parallel pending claims on the same original', async () => {
    const s = await setup(),
      root = structuredClone(s.sample);
    const original = await s.ready();
    async function candidate(sample: ReturnType<typeof correctionSample>) {
      Object.assign(s.sample, sample);
      const approval = await s.approvals.approve(s.reviewer.headers, {
        reviewId: randomUUID(),
        expectedDigest: reviewDigest(sample.raw, sample.context),
        idempotencyKey: randomUUID(),
      });
      return s.run(sample.raw, approval.id, randomUUID());
    }
    await expect(
      candidate(correctionSample(root, original.candidate.runId, '1', '-100000', '1180000')),
    ).rejects.toMatchObject({ code: 'conflict' });
    await s.publish(s.publisher.headers, original.command);
    expect(
      (await candidate(correctionSample(root, original.candidate.runId, '1', '-100000', '1180000')))
        .state,
    ).toBe('ready');
    await expect(
      candidate(
        correctionSample(
          root,
          original.candidate.runId,
          '2',
          '-100000',
          '1180000',
          '2026-09-03',
          '2026-09-05',
        ),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    const wrong = correctionSample(
      root,
      randomUUID(),
      '2',
      '-100000',
      '1180000',
      '2026-09-03',
      '2026-09-05',
    );
    await expect(candidate(wrong)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('imports partial cash and withholding, replays once, and reverses with immutable evidence', async () => {
    const s = await setup();
    const ready = await s.ready();
    const statement = await s.publish(s.publisher.headers, ready.command);
    const finance = await actor(['record_payments']);
    const payment = {
      kind: 'payment' as const,
      partnerId: s.partnerId,
      source: { authority: 'synthetic-finance', account: 'payor-1', reference: randomUUID() },
      evidenceRef: 'synthetic-payment-evidence',
      occurredAt: '2026-09-01T12:00:00.000Z',
      cashMinor: '580000',
      withholdingMinor: '20000',
      otherMinor: '0',
      allocations: [
        {
          statementId: statement.id,
          cashMinor: '580000',
          withholdingMinor: '20000',
          otherMinor: '0',
          otherReasonRef: null,
        },
      ],
    };
    let source: unknown = payment;
    let reads = 0;
    const settle = createSettlementImporter(access, {
      load: async () => {
        reads++;
        return source;
      },
    });
    const command = {
      sourceRecordId: randomUUID(),
      expectedDigest: settlementDigest(payment),
      idempotencyKey: randomUUID(),
    };
    await expect(settle(s.publisher.headers, command)).rejects.toMatchObject({ code: 'forbidden' });
    expect(reads).toBe(0);
    const results = await Promise.all([
      settle(finance.headers, command),
      settle(finance.headers, command),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    const [balance] =
      await sql`select sum(cash_minor)::text as cash,sum(withholding_minor)::text as withholding,
      sum(cash_minor+withholding_minor+other_minor)::text as settled from portal_statements.allocations where statement_id=${statement.id}`;
    expect(balance).toEqual({ cash: '580000', withholding: '20000', settled: '600000' });
    expect(3736000n - BigInt(balance.settled)).toBe(3136000n);
    expect(
      await settle(finance.headers, { ...command, idempotencyKey: randomUUID() }),
    ).toMatchObject({ id: results[0].id, replayed: true });
    expect(
      (
        await sql`select settlements::text from portal_statements.revisions where partner_id=${s.partnerId}`
      )[0].settlements,
    ).toBe('1');
    source = { ...payment, evidenceRef: 'changed-evidence' };
    await expect(
      settle(finance.headers, {
        ...command,
        expectedDigest: settlementDigest(source),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    source = {
      kind: 'reversal',
      partnerId: s.partnerId,
      source: { ...payment.source, reference: randomUUID() },
      original: payment.source,
      evidenceRef: 'synthetic-reversal-proof',
      reasonRef: 'synthetic-correction',
      occurredAt: '2026-09-02T12:00:00.000Z',
    };
    const reversed = await settle(finance.headers, {
      ...command,
      expectedDigest: settlementDigest(source),
      idempotencyKey: randomUUID(),
    });
    expect(reversed.replayed).toBe(false);
    expect(
      (
        await sql`select sum(cash_minor+withholding_minor+other_minor)::text as settled from portal_statements.allocations where statement_id=${statement.id}`
      )[0].settled,
    ).toBe('0');
    expect(
      (
        await sql`select settlements::text from portal_statements.revisions where partner_id=${s.partnerId}`
      )[0].settlements,
    ).toBe('2');
    await expect(
      sql`delete from portal_statements.allocations where settlement_id=${reversed.id}`,
    ).rejects.toThrow('append-only');
    source = { ...(source as object), source: { ...payment.source, reference: randomUUID() } };
    await expect(
      settle(finance.headers, {
        ...command,
        expectedDigest: settlementDigest(source),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
  it('allows only one competing full payment and rejects cross-partner allocations atomically', async () => {
    const s = await setup();
    const ready = await s.ready();
    const statement = await s.publish(s.publisher.headers, ready.command);
    const finance = await actor(['record_payments']);
    const payment = {
      kind: 'payment' as const,
      partnerId: s.partnerId,
      source: { authority: 'synthetic-finance', account: 'payor-1', reference: randomUUID() },
      evidenceRef: 'synthetic-proof',
      occurredAt: '2026-09-01T12:00:00.000Z',
      cashMinor: '3736000',
      withholdingMinor: '0',
      otherMinor: '0',
      allocations: [
        {
          statementId: statement.id,
          cashMinor: '3736000',
          withholdingMinor: '0',
          otherMinor: '0',
          otherReasonRef: null,
        },
      ],
    };
    const competing = [
      payment,
      { ...payment, source: { ...payment.source, reference: randomUUID() } },
    ];
    const settle = createSettlementImporter(access, { load: async (id) => competing[Number(id)] });
    const results = await Promise.allSettled(
      competing.map((r, i) =>
        settle(finance.headers, {
          sourceRecordId: String(i),
          expectedDigest: settlementDigest(r),
          idempotencyKey: randomUUID(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const foreign = {
      ...payment,
      source: { ...payment.source, reference: randomUUID() },
      cashMinor: '2',
      allocations: [
        { ...payment.allocations[0], cashMinor: '1', statementId: randomUUID() },
        { ...payment.allocations[0], cashMinor: '1' },
      ],
    };
    const foreignSettle = createSettlementImporter(access, { load: async () => foreign });
    await expect(
      foreignSettle(finance.headers, {
        sourceRecordId: 'foreign',
        expectedDigest: settlementDigest(foreign),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(
      (
        await sql`select count(*)::int as count from portal_statements.settlements where partner_id=${s.partnerId}`
      )[0].count,
    ).toBe(1);
    expect(SourceSettlement.safeParse({ ...payment, cashMinor: '3736001' }).success).toBe(false);
    expect(
      SourceSettlement.safeParse({
        ...payment,
        otherMinor: '1',
        allocations: [{ ...payment.allocations[0], otherMinor: '1' }],
      }).success,
    ).toBe(false);
  });
  it('reconciles six synthetic rights, freezes once, and retains exact replay and row evidence', async () => {
    const s = await setup();
    const { approval, candidate, command } = await s.ready();
    expect(await s.approvals.approve(s.reviewer.headers, s.approveInput)).toMatchObject({
      ...approval,
      replayed: true,
    });
    const results = await Promise.all([
      s.publish(s.publisher.headers, command),
      s.publish(s.publisher.headers, command),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    const [statement] =
      await sql`select generation_id,new_earnings_minor::text as amount,opening_minor::text as opening,
      adjustments_minor::text as adjustments from portal_statements.statements where partner_id=${s.partnerId}`;
    expect(statement).toEqual({
      generation_id: candidate.runId,
      amount: '3736000',
      opening: '0',
      adjustments: '0',
    });
    const [totals] = await sql`select count(*)::int as count,sum(amount_minor)::text as amount,
      sum(eligible_base_minor)::text as base from portal_imports.earning_rows where generation_id=${candidate.runId}`;
    expect(totals).toEqual({ count: 6, amount: '3736000', base: '55000000' });
    expect(
      (
        await sql`select statements::text from portal_statements.revisions where partner_id=${s.partnerId}`
      )[0].statements,
    ).toBe('1');
    await expect(
      s.publish(s.publisher.headers, { ...command, scheduledAt: '2026-09-16T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      s.publish(s.publisher.headers, { ...command, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      sql`update portal_statements.statements set new_earnings_minor=1 where id=${results[0].id}`,
    ).rejects.toThrow('append-only');
    await expect(sql`delete from portal_imports.approvals where id=${approval.id}`).rejects.toThrow(
      'append-only',
    );
    await expect(s.run(s.sample.raw, approval.id, randomUUID())).rejects.toThrow();
  });
  it('denies mismatched source digest and permission before evidence access; rejects stale/revoked staff', async () => {
    const s = await setup();
    await expect(s.approvals.approve(new Headers(), s.approveInput)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(s.approvals.approve(s.publisher.headers, s.approveInput)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(s.reads()).toBe(0);
    await expect(
      s.approvals.approve(s.reviewer.headers, {
        ...s.approveInput,
        expectedDigest: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (
        await sql`select count(*)::int as count from portal_imports.approvals where partner_id=${s.partnerId}`
      )[0].count,
    ).toBe(0);
    await sql`update portal_identity.sessions set created_at=clock_timestamp()-interval '1 day' where user_id=${s.reviewer.id}`;
    await expect(s.approvals.approve(s.reviewer.headers, s.approveInput)).rejects.toMatchObject({
      code: 'fresh_auth_required',
    });
    await sql`update portal_access.staff_grants set active=false where user_id=${s.publisher.id}`;
    await expect(
      s.publish(s.publisher.headers, {
        partnerId: s.partnerId,
        generationId: randomUUID(),
        approvalId: randomUUID(),
        scheduledAt: '2026-09-15T00:00:00.000Z',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('cannot publish a foreign, revoked or suspended candidate', async () => {
    const s = await setup();
    const { approval, command } = await s.ready();
    await expect(s.publish(s.reviewer.headers, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      s.publish(s.publisher.headers, { ...command, partnerId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await sql`update portal_access.partners set status='suspended' where id=${s.partnerId}`;
    await expect(s.publish(s.publisher.headers, command)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await sql`update portal_access.partners set status='active' where id=${s.partnerId}`;
    const revocation = {
      approvalId: approval.id,
      reasonRef: 'synthetic-source-correction',
      idempotencyKey: randomUUID(),
    };
    await s.approvals.revoke(s.reviewer.headers, revocation);
    expect(await s.approvals.revoke(s.reviewer.headers, revocation)).toMatchObject({
      id: approval.id,
      replayed: true,
    });
    await expect(s.approvals.repository.load(approval.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(s.publish(s.publisher.headers, command)).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      s.approvals.approve(s.reviewer.headers, { ...s.approveInput, idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(
      (
        await sql`select count(*)::int as count from portal_statements.statements where partner_id=${s.partnerId}`
      )[0].count,
    ).toBe(0);
  });
  it('rejects a replaced generation and invalid schedule, then publishes the current generation', async () => {
    const s = await setup();
    const { command } = await s.ready();
    const approval = await s.approvals.approve(s.reviewer.headers, {
      ...s.approveInput,
      reviewId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    const candidate = await s.run(s.sample.raw, approval.id, randomUUID());
    expect(candidate.state).toBe('ready');
    await expect(s.publish(s.publisher.headers, command)).rejects.toMatchObject({
      code: 'conflict',
    });
    const next = { ...command, generationId: candidate.runId, approvalId: approval.id };
    await expect(
      s.publish(s.publisher.headers, { ...next, scheduledAt: '2026-08-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await s.publish(s.publisher.headers, next)).toMatchObject({
      version: candidate.runId,
      replayed: false,
    });
  });
});
