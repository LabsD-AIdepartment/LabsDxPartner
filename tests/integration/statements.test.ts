import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
describe('native authorized approval to immutable statement on PostgreSQL', () => {
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
