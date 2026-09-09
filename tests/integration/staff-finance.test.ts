import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createStaffFinanceHttp } from '@/server/http/staff-finance';
import { createFinanceReader } from '@/server/modules/staff-finance/read-model';
import { createApprovalStore } from '@/server/modules/imports/approval-store';
import { FinanceSnapshot } from '@/contracts/staff-finance';
import { loadFinance } from '@/features/staff-finance/http';
type Scope = Awaited<ReturnType<typeof setup>>;
async function request(s: Scope, extra: Record<string, string> = {}, headers = s.staff.headers) {
  return createStaffFinanceHttp(
    access,
    config.BETTER_AUTH_URL,
  )(
    new Request(
      config.BETTER_AUTH_URL +
        '/api/v1/staff/periods?' +
        new URLSearchParams({ expectedRevision: '1', partnerId: s.partnerId, ...extra }),
      { headers },
    ),
  );
}
async function read(s: Scope, extra: Record<string, string> = {}) {
  const response = await request(s, extra);
  if (response.status === 503)
    await createFinanceReader(access)(s.staff.headers, {
      expectedRevision: '1',
      partnerId: s.partnerId,
      ...extra,
    });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return FinanceSnapshot.parse(await response.json());
}
async function publish(s: Scope, command: unknown, origin = config.BETTER_AUTH_URL) {
  const headers = new Headers(s.staff.headers);
  headers.set('origin', origin);
  headers.set('content-type', 'application/json');
  return createStaffFinanceHttp(
    access,
    config.BETTER_AUTH_URL + '/',
    true,
  )(
    new Request(config.BETTER_AUTH_URL + '/api/v1/staff/periods/publish', {
      method: 'POST',
      headers,
      body: JSON.stringify(command),
    }),
  );
}
function command(s: Scope, generationId: string, approvalId: string) {
  return {
    expectedStaffRevision: '1',
    partnerId: s.partnerId,
    generationId,
    approvalId,
    scheduledAt: '2026-09-15T05:00:00Z',
    idempotencyKey: randomUUID(),
  };
}
describe('native staff review and statement publication', () => {
  it('reads reconciled exact rows, publishes once, and exposes the same immutable statement', async () => {
    const s = await setup(),
      draft = await s.ingest();
    const list = await read(s),
      period = list.periods.items[0];
    expect(period).toMatchObject({
      state: 'ready',
      generationId: draft.candidate.runId,
      approvalId: draft.approval.id,
      amount: { minor: '3736000' },
      eligibleBase: { minor: '55000000' },
      includedCount: 6,
      excludedCount: 0,
      closing: null,
    });
    const detail = await read(s, { scopeId: period.id });
    expect(detail.lines!.items).toHaveLength(6);
    expect(detail.lines!.items.reduce((n, l) => n + BigInt(l.amount!.minor), 0n)).toBe(3736000n);
    expect(
      detail.lines!.items.every((l) => l.evidenceRef && l.agreementVersion && l.contentId),
    ).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('approval_context');
    const input = command(s, draft.candidate.runId, draft.approval.id);
    const response = await publish(s, input);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ replayed: false, version: draft.candidate.runId });
    expect(await (await publish(s, input)).json()).toMatchObject({
      id: receipt.id,
      replayed: true,
    });
    const issued = (await read(s, { scopeId: period.id })).periods.items[0];
    expect(issued).toMatchObject({
      state: 'published',
      statementId: receipt.id,
      closing: { minor: '3736000' },
      settled: { minor: '0' },
    });
    const [count] =
      await sql`select count(*)::int as n from portal_statements.statements where partner_id=${s.partnerId}`;
    expect(count.n).toBe(1);
  });
  it('uses current finance capability, rejects partners, stale revisions and revoked grants', async () => {
    const s = await setup(),
      draft = await s.ingest();
    await sql`update portal_access.staff_grants set capabilities=ARRAY['publish_statements'] where user_id=${s.staff.id}`;
    expect((await read(s)).periods.items[0].state).toBe('ready');
    expect((await request(s, {}, s.viewer.headers)).status).toBe(403);
    expect((await request(s, { expectedRevision: '99' })).status).toBe(403);
    await sql`update portal_access.staff_grants set revision=revision+1 where user_id=${s.staff.id}`;
    expect((await publish(s, command(s, draft.candidate.runId, draft.approval.id))).status).toBe(
      403,
    );
    expect((await request(s)).status).toBe(403);
    expect((await request(s, { expectedRevision: '2' })).status).toBe(200);
    await sql`update portal_access.staff_grants set active=false where user_id=${s.staff.id}`;
    expect((await request(s, { expectedRevision: '2' })).status).toBe(403);
  });
  it('blocks revoked approvals and stale generations without issuing money', async () => {
    const s = await setup(),
      old = await s.ingest(),
      newer = await s.ingest();
    expect((await publish(s, command(s, old.candidate.runId, old.approval.id))).status).toBe(409);
    const period = (await read(s)).periods.items[0];
    expect(
      (await request(s, { scopeId: period.id, generationId: old.candidate.runId })).status,
    ).toBe(409);
    await createApprovalStore(sql, access, { load: async () => s.sample }).revoke(s.staff.headers, {
      approvalId: newer.approval.id,
      reasonRef: 'synthetic-source-retracted',
      idempotencyKey: randomUUID(),
    });
    expect((await read(s)).periods.items[0]).toMatchObject({
      state: 'blocked',
      issues: ['การอนุมัติข้อมูลต้นทางถูกยกเลิก'],
    });
    expect((await publish(s, command(s, newer.candidate.runId, newer.approval.id))).status).toBe(
      409,
    );
    const [count] =
      await sql`select count(*)::int as n from portal_statements.statements where partner_id=${s.partnerId}`;
    expect(count.n).toBe(0);
  });
  it('rejects foreign origin, browser-supplied amounts and changed replay inputs', async () => {
    const s = await setup(),
      draft = await s.ingest(),
      input = command(s, draft.candidate.runId, draft.approval.id);
    expect((await publish(s, input, 'https://foreign.example.test')).status).toBe(403);
    expect((await publish(s, { ...input, amountMinor: '999999999' })).status).toBe(400);
    expect((await publish(s, { ...input, expectedStaffRevision: undefined })).status).toBe(400);
    expect((await publish(s, { ...input, scheduledAt: '2026-08-01T00:00:00Z' })).status).toBe(400);
    expect((await publish(s, input)).status).toBe(200);
    expect((await publish(s, { ...input, scheduledAt: '2026-09-16T00:00:00Z' })).status).toBe(409);
  });
  it('bounds period pages and binds cursors to the actor and literal search', async () => {
    const s = await setup();
    for (let i = 0; i < 23; i++)
      await sql`insert into portal_imports.scopes(id,partner_id,period_from,period_to) values(${randomUUID()},${s.partnerId},${new Date(Date.UTC(2024, i, 1)).toISOString()},${new Date(Date.UTC(2024, i + 1, 1)).toISOString()})`;
    const first = await read(s);
    expect(first.periods.items).toHaveLength(20);
    expect(first.periods.items.every((p) => p.state === 'waiting' && p.amount === null)).toBe(true);
    const second = await read(s, { cursor: first.periods.nextCursor! });
    expect(second.periods.items).toHaveLength(3);
    expect(new Set([...first.periods.items, ...second.periods.items].map((p) => p.id)).size).toBe(
      23,
    );
    expect((await request(s, { cursor: first.periods.nextCursor!, q: 'Overview' })).status).toBe(
      409,
    );
    expect((await read(s, { q: '%' })).periods.items).toEqual([]);
    const foreign = await setup();
    expect((await request(foreign, { scopeId: first.periods.items[0].id })).status).toBe(403);
  });
  it('continues tied earning rows exactly and omits undefined client selection fields', async () => {
    const s = await setup(),
      original = s.sample.file.rows[0];
    if (original.disposition !== 'included') throw new Error('Expected income');
    for (let i = 0; i < 25; i++) {
      const row = {
        ...structuredClone(original),
        entitlement: { ...original.entitlement, reference: 'extra-' + i },
        earnedAt: '2026-08-30T05:00:00.000001Z',
        earning: { kind: 'bonus' as const, amountMinor: '1', approvalRef: 'bonus-' + i },
      };
      s.sample.file.rows.push(row);
      s.sample.context.amounts.push({
        entitlement: row.entitlement,
        agreementVersion: row.agreementVersion,
        earnedAt: row.earnedAt,
        evidenceRef: row.evidenceRef,
        earning: row.earning,
      });
      s.sample.context.attributions.push({
        ...s.sample.context.attributions[0],
        entitlement: row.entitlement,
      });
    }
    const controls = {
      rows: 31,
      included: 31,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '55000000',
      amountMinor: '3736025',
    };
    s.sample.file.sources[0].controls = controls;
    s.sample.context.sources[0].controls = controls;
    await s.ingest();
    const p = (await read(s)).periods.items[0],
      selection = { partnerId: s.partnerId, scopeId: p.id };
    const first = await read(s, { scopeId: p.id });
    expect(first.lines!.items).toHaveLength(20);
    const last = await read(s, {
      scopeId: p.id,
      generationId: p.generationId!,
      lineCursor: first.lines!.nextCursor!,
    });
    const rows = [...first.lines!.items, ...last.lines!.items];
    expect(rows).toHaveLength(31);
    expect(new Set(rows.map((r) => r.id)).size).toBe(31);
    expect(rows.reduce((n, r) => n + BigInt(r.amount!.minor), 0n)).toBe(3736025n);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) =>
        createStaffFinanceHttp(
          access,
          config.BETTER_AUTH_URL,
        )(new Request(config.BETTER_AUTH_URL + url, { ...init, headers: s.staff.headers })),
      ),
    );
    try {
      const client = await loadFinance(
        first.session,
        { ...selection, lineCursor: undefined },
        new AbortController().signal,
      );
      expect(client.lines!.items).toHaveLength(20);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('retains explicit exclusions and requires fresh authentication for publication', async () => {
  const s = await setup(),
    original = s.sample.file.rows[0];
  const entitlement = { ...original.entitlement, reference: 'excluded-trial' };
  const row = {
    entitlement,
    sourceId: original.sourceId,
    sourceAccount: original.sourceAccount,
    sourceRevision: original.sourceRevision,
    earnedAt: original.earnedAt,
    evidenceRef: 'excluded-evidence',
    disposition: 'excluded' as const,
    reasonRef: 'returned-order',
    approvalRef: 'source-exclusion',
  };
  s.sample.file.rows.push(row);
  s.sample.context.exclusions.push({
    entitlement,
    reasonRef: row.reasonRef,
    approvalRef: row.approvalRef,
  });
  const controls = {
    rows: 7,
    included: 6,
    excluded: 1,
    unresolved: 0,
    eligibleBaseMinor: '55000000',
    amountMinor: '3736000',
  };
  s.sample.file.sources[0].controls = controls;
  s.sample.context.sources[0].controls = controls;
  const draft = await s.ingest(),
    p = (await read(s)).periods.items[0];
  const detail = await read(s, { scopeId: p.id });
  expect(detail.lines!.totalCount).toBe(7);
  expect(detail.lines!.items.find((l) => l.kind === 'excluded')).toMatchObject({
    reference: 'excluded-trial',
    reasonRef: 'returned-order',
    evidenceRef: 'excluded-evidence',
    amount: null,
  });
  await sql`update portal_identity.sessions set created_at=clock_timestamp()-interval '1 day' where user_id=${s.staff.id}`;
  expect((await read(s)).periods.items[0].amount?.minor).toBe('3736000');
  const response = await publish(s, command(s, draft.candidate.runId, draft.approval.id));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ code: 'FRESH_AUTH_REQUIRED' });
});
