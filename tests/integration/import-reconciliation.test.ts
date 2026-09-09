import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { celebrityPeriod } from '../../dev/financial/celebrity-period';
import { createImportRunner } from '@/server/modules/imports/run';
let sql: Awaited<ReturnType<typeof connectTestDatabase>>;
beforeAll(async () => {
  sql = await connectTestDatabase();
});
afterAll(async () => {
  await sql.end();
});
async function setup() {
  const partnerId = randomUUID();
  await sql`insert into portal_access.partners(id,name,status) values(${partnerId},'Synthetic celebrity','active')`;
  const sample = celebrityPeriod(partnerId);
  let sequence = '1';
  const run = createImportRunner(sql, {
    load: async () => ({ sequence, context: sample.context }),
  });
  return {
    ...sample,
    partnerId,
    run,
    setSequence: (s: string) => {
      sequence = s;
    },
  };
}
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
describe('persisted reconciled candidate imports on isolated PostgreSQL', () => {
  it('replaces an open entitlement revision and applies a cumulative refund only once', async () => {
    const s = await setup();
    const original = await s.run(s.raw, 'approval-1', 'original');
    const row = s.file.rows[0];
    if (row.disposition !== 'included' || row.earning.kind !== 'commission') throw new Error();
    row.sourceRevision = 'row-2';
    row.earning.baseMinor = '12700000';
    row.earning.amountMinor = '1270000';
    const controls = {
      rows: 6,
      included: 6,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '54900000',
      amountMinor: '3726000',
    };
    s.file.sources[0].controls = controls;
    s.context.sources[0].controls = controls;
    s.file.sources[0].revision = 'snapshot-2';
    s.context.sources[0].revision = 'snapshot-2';
    Object.assign(s.context.groups[0], { baseMinor: '29700000', amountMinor: '2970000' });
    const raw = JSON.stringify(s.file);
    s.context.fileSha256 = digest(raw);
    s.setSequence('2');
    const revised = await s.run(raw, 'approval-2', 'refund');
    expect(await s.run(raw, 'approval-2', 'refund')).toMatchObject({
      runId: revised.runId,
      replayed: true,
    });
    const rows =
      await sql`select id,amount_minor::text as amount from portal_imports.generations where id in (${original.runId},${revised.runId})`;
    expect(rows.find((r) => r.id === original.runId)?.amount).toBe('3736000');
    expect(rows.find((r) => r.id === revised.runId)?.amount).toBe('3726000');
    expect(
      (
        await sql`select count(*)::int as count from portal_imports.earning_rows where generation_id=${revised.runId}`
      )[0].count,
    ).toBe(6);
  });
  it('retains approved fixed fees and bonuses without manufacturing a sales base', async () => {
    const s = await setup();
    const seed = s.file.rows[0];
    if (seed.disposition !== 'included') throw new Error();
    for (const [kind, amount] of [
      ['fixed-fee', '250000'],
      ['bonus', '50000'],
    ] as const) {
      const row = {
        ...seed,
        entitlement: { ...seed.entitlement, right: kind },
        attribution: { kind: 'partner-only' as const },
        earning: { kind, amountMinor: amount, approvalRef: 'synthetic-' + kind },
      };
      s.file.rows.push(row);
      s.context.amounts.push({
        entitlement: row.entitlement,
        agreementVersion: row.agreementVersion,
        earnedAt: row.earnedAt,
        evidenceRef: row.evidenceRef,
        earning: row.earning,
      });
    }
    const controls = {
      rows: 8,
      included: 8,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '55000000',
      amountMinor: '4036000',
    };
    s.file.sources[0].controls = controls;
    s.context.sources[0].controls = controls;
    const raw = JSON.stringify(s.file);
    s.context.fileSha256 = digest(raw);
    const result = await s.run(raw, 'approval-fixed', 'fixed');
    expect(result.state).toBe('ready');
    const amounts =
      await sql`select payload->'earning'->>'kind' as kind,amount_minor::text as amount,eligible_base_minor,content_id from portal_imports.earning_rows where generation_id=${result.runId} and payload->'earning'->>'kind' in ('fixed-fee','bonus') order by kind`;
    expect(amounts).toEqual([
      { kind: 'bonus', amount: '50000', eligible_base_minor: null, content_id: null },
      { kind: 'fixed-fee', amount: '250000', eligible_base_minor: null, content_id: null },
    ]);
  });
  it('distinguishes an explicitly approved empty period from missing input', async () => {
    const s = await setup();
    s.file.rows = [];
    s.context.groups = [];
    s.context.attributions = [];
    const controls = {
      rows: 0,
      included: 0,
      excluded: 0,
      unresolved: 0,
      eligibleBaseMinor: '0',
      amountMinor: '0',
    };
    s.file.sources[0].controls = controls;
    s.context.sources[0].controls = controls;
    const raw = JSON.stringify(s.file);
    s.context.fileSha256 = digest(raw);
    const result = await s.run(raw, 'empty-approval', 'empty');
    expect(result.state).toBe('ready');
    expect(
      (
        await sql`select amount_minor::text as amount,included_count from portal_imports.generations where id=${result.runId}`
      )[0],
    ).toEqual({ amount: '0', included_count: 0 });
  });
  it('stores six exact earnings, replays once, and replaces the draft without adding duplicate money', async () => {
    const s = await setup();
    const first = await s.run(s.raw, 'approval-1', 'command-1');
    expect(first).toMatchObject({ state: 'ready', replayed: false });
    expect(await s.run(s.raw, 'approval-1', 'command-1')).toEqual({ ...first, replayed: true });
    const [sum] =
      await sql`select count(*)::int as count,sum(amount_minor)::text as amount,sum(eligible_base_minor)::text as base from portal_imports.earning_rows where generation_id=${first.runId}`;
    expect(sum).toEqual({ count: 6, amount: '3736000', base: '55000000' });
    s.setSequence('2');
    const second = await s.run(s.raw, 'approval-2', 'command-2');
    const [current] =
      await sql`select g.amount_minor::text as amount,s.current_generation from portal_imports.scopes s join portal_imports.generations g on g.id=s.current_generation where s.partner_id=${s.partnerId}`;
    expect(current).toEqual({ amount: '3736000', current_generation: second.runId });
    expect(
      (
        await sql`select count(*)::int as count from portal_imports.earning_rows where generation_id=${first.runId}`
      )[0].count,
    ).toBe(6);
    s.setSequence('1');
    await expect(s.run(s.raw, 'approval-1', 'old-command')).rejects.toMatchObject({
      code: 'superseded',
    });
  });
  it('keeps the last good generation on corrupt input and refuses reusing a command with different bytes', async () => {
    const s = await setup();
    const first = await s.run(s.raw, 'approval-1', 'first');
    s.setSequence('2');
    const failed = await s.run(s.raw + ' ', 'approval-2', 'bad');
    expect(failed).toMatchObject({ state: 'failed', issues: [{ code: 'snapshot_mismatch' }] });
    expect(
      (
        await sql`select current_generation from portal_imports.scopes where partner_id=${s.partnerId}`
      )[0].current_generation,
    ).toBe(first.runId);
    await expect(s.run(s.raw, 'approval-2', 'bad')).rejects.toMatchObject({ code: 'conflict' });
  });
  it('allows only one concurrent candidate publication for the same approval sequence', async () => {
    const s = await setup();
    const results = await Promise.allSettled([
      s.run(s.raw, 'approval-1', 'one'),
      s.run(s.raw, 'approval-1', 'two'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [count] =
      await sql`select count(*)::int as count from portal_imports.generations g join portal_imports.scopes s on s.id=g.scope_id where s.partner_id=${s.partnerId}`;
    expect(count.count).toBe(1);
  });
  it('does not promote unresolved rows into a ready candidate', async () => {
    const s = await setup();
    const row = s.file.rows[0];
    if (row.disposition !== 'included') throw new Error();
    const { earning, attribution, agreementVersion, ...base } = row;
    s.file.rows[0] = { ...base, disposition: 'unresolved', reasonRef: 'missing-source-evidence' };
    const controls = {
      rows: 6,
      included: 5,
      excluded: 0,
      unresolved: 1,
      eligibleBaseMinor: '42200000',
      amountMinor: '2456000',
    };
    s.file.sources[0].controls = controls;
    s.context.sources[0].controls = controls;
    Object.assign(s.context.groups[0], { rows: 2, baseMinor: '17000000', amountMinor: '1700000' });
    s.context.attributions.shift();
    const raw = JSON.stringify(s.file);
    s.context.fileSha256 = digest(raw);
    expect(await s.run(raw, 'approval-1', 'blocked')).toMatchObject({
      state: 'blocked',
      issues: [{ code: 'unresolved_row', row: 0 }],
    });
    expect(
      (
        await sql`select current_generation from portal_imports.scopes where partner_id=${s.partnerId}`
      )[0].current_generation,
    ).toBeNull();
  });
  it('refuses overlapping periods, suspended partners and frozen scope rewrites', async () => {
    const s = await setup();
    await s.run(s.raw, 'approval-1', 'one');
    s.setSequence('2');
    await sql`update portal_imports.scopes set closed_statement_ref='synthetic-issued-1' where partner_id=${s.partnerId}`;
    await expect(s.run(s.raw, 'approval-2', 'two')).rejects.toMatchObject({
      code: 'closed_period',
    });
    s.context.period = { ...s.context.period, toExclusive: '2026-09-02T00:00:00+07:00' };
    await expect(s.run(s.raw, 'approval-3', 'three')).rejects.toMatchObject({
      code: 'overlapping_period',
    });
    await sql`update portal_access.partners set status='suspended' where id=${s.partnerId}`;
    await expect(s.run(s.raw, 'approval-4', 'four')).rejects.toMatchObject({
      code: 'inactive_partner',
    });
  });
  it('rejects mutation of an accepted candidate row', async () => {
    const s = await setup();
    const result = await s.run(s.raw, 'approval-1', 'one');
    await expect(
      sql`update portal_imports.earning_rows set amount_minor=0 where generation_id=${result.runId}`,
    ).rejects.toThrow('Candidate generations are immutable');
  });
  it('fences an expired worker after another worker has committed a newer generation', async () => {
    const s = await setup();
    let claimDone!: () => void, resume!: () => void;
    const claimed = new Promise<void>((resolve) => {
      claimDone = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let calls = 0;
    const delayed = new Proxy(sql, {
      get(target, key) {
        if (key !== 'begin') return Reflect.get(target, key);
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(target.begin, target, args);
          if (++calls === 1) {
            claimDone();
            await release;
          }
          return result;
        };
      },
    });
    const old = createImportRunner(delayed, {
      load: async () => ({ sequence: '1', context: s.context }),
    })(s.raw, 'approval-1', 'old');
    // Attach the rejection observer before releasing the deliberately paused worker.
    const oldResult = old.then(
      () => null,
      (error) => error,
    );
    await claimed;
    let next;
    try {
      await sql`update portal_imports.scopes set lease_until=clock_timestamp()-interval '1 second' where partner_id=${s.partnerId}`;
      s.setSequence('2');
      next = await s.run(s.raw, 'approval-2', 'new');
    } finally {
      resume();
    }
    expect(await oldResult).toMatchObject({ code: 'superseded' });
    expect(
      (
        await sql`select current_generation,lease_token from portal_imports.scopes where partner_id=${s.partnerId}`
      )[0],
    ).toMatchObject({ current_generation: next!.runId, lease_token: null });
    expect(
      (
        await sql`select state from portal_imports.runs where scope_id=(select id from portal_imports.scopes where partner_id=${s.partnerId}) and idempotency_key='old'`
      )[0].state,
    ).toBe('superseded');
  });
  it('rolls back a candidate that would pay the same logical right in a second period', async () => {
    const s = await setup();
    const first = await s.run(s.raw, 'approval-1', 'first');
    const period = {
      ...s.file.period,
      from: '2026-09-01T00:00:00+07:00',
      toExclusive: '2026-11-01T00:00:00+07:00',
    };
    s.file.period = period;
    s.context.period = period;
    s.file.sources[0].asOf = period.toExclusive;
    s.context.sources[0].asOf = period.toExclusive;
    for (const group of s.context.groups) {
      group.effective = period;
      group.calculationWindow = period;
    }
    for (const row of s.file.rows) row.earnedAt = row.earnedAt.replace('2026-08', '2026-10');
    const raw = JSON.stringify(s.file);
    s.context.fileSha256 = digest(raw);
    await expect(s.run(raw, 'approval-new-period', 'new-period')).rejects.toMatchObject({
      code: 'conflict',
    });
    const [result] =
      await sql`select count(*)::int as count from portal_imports.generations g join portal_imports.scopes s on s.id=g.scope_id where s.partner_id=${s.partnerId}`;
    expect(result.count).toBe(1);
    expect(
      (
        await sql`select sum(amount_minor)::text as amount from portal_imports.earning_rows where generation_id=${first.runId}`
      )[0].amount,
    ).toBe('3736000');
    expect(
      (
        await sql`select state from portal_imports.runs where idempotency_key='new-period' and scope_id in (select id from portal_imports.scopes where partner_id=${s.partnerId})`
      )[0].state,
    ).toBe('failed');
  });
});
