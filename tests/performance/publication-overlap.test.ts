import { describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { setup, sql } from '../helpers/partner-finance';
import { OverviewResponse } from '@/contracts/overview-http';

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function periodSample(f: Awaited<ReturnType<typeof setup>>, next: boolean) {
  const input = structuredClone(f.sample);
  const original = input.file.rows[0];
  if (original.disposition !== 'included' || original.earning.kind !== 'commission')
    throw new Error('Expected commission template');
  const period = next
    ? {
        from: '2026-09-01T00:00:00+07:00',
        toExclusive: '2026-09-03T00:00:00+07:00',
        timezone: 'Asia/Bangkok' as const,
      }
    : input.file.period;
  const base = next ? '200005' : '100005';
  const amount = next ? '20001' : '10001';
  const controls = {
    rows: 1000,
    included: 1000,
    excluded: 0,
    unresolved: 0,
    eligibleBaseMinor: next ? '200005000' : '100005000',
    amountMinor: next ? '20001000' : '10001000',
  };
  input.file.period = input.context.period = period;
  input.file.sources[0].controls = input.context.sources[0].controls = controls;
  input.file.sources[0].asOf = input.context.sources[0].asOf = next
    ? '2026-09-03T12:00:00+07:00'
    : '2026-09-01T12:00:00+07:00';
  input.file.rows = Array.from({ length: 1000 }, (_, i) => ({
    ...original,
    entitlement: { ...original.entitlement, reference: `overlap-${next}-${i}` },
    earnedAt: (next ? '2026-09-01' : '2026-08-30') + 'T12:00:00+07:00',
    attribution: {
      kind: 'content' as const,
      contentId: i % 2 ? 'clip-3' : 'clip-1',
      evidenceRef: `synthetic-map-${i}`,
    },
    earning: { ...original.earning, baseMinor: base, amountMinor: amount },
  }));
  input.context.groups = [
    {
      ...input.context.groups[0],
      effective: period,
      calculationWindow: period,
      rows: 1000,
      baseMinor: controls.eligibleBaseMinor,
      amountMinor: controls.amountMinor,
    },
  ];
  input.context.attributions = input.file.rows.map((row) => {
    if (row.disposition !== 'included' || row.attribution.kind !== 'content')
      throw new Error('Expected content attribution');
    return {
      entitlement: row.entitlement,
      contentId: row.attribution.contentId,
      evidenceRef: row.attribution.evidenceRef,
    };
  });
  return input;
}

function snapshot(response: ReturnType<typeof OverviewResponse.parse>) {
  const { asOf: _clock, ...obligation } = response.data.obligation;
  return {
    earnings: response.data.earnings,
    obligation,
    earningsRevision: response.earningsRevision,
    settlementsRevision: response.settlementsRevision,
    catalogueRevision: response.catalogueRevision,
    profile: response.data.profile,
    brands: response.data.brands,
    dataState: response.data.dataState,
    reasons: response.data.reasons,
    dataThrough: response.data.dataThrough,
  };
}

describe('Overview reads overlapping actual statement publication', () => {
  it('returns a complete old or new snapshot while the publisher is held immediately before its revision update', async () => {
    const f = await setup({ sessionFixture: 'persisted' });
    await f.catalogue();
    await (await f.ingest(periodSample(f, false))).publish();
    const ready = await f.ingest(periodSample(f, true));
    const range = { toExclusive: '2026-09-03' };
    const before = await f.read(range);
    const old = snapshot(before);
    expect(old.earnings.confirmed?.minor).toBe('10001000');
    expect(old.obligation.confirmedUnpaid?.minor).toBe('10001000');
    // A reconciled but unissued generation is private even while readers poll.
    const samples: { phase: string; ms: number; bytes: number; value: typeof old }[] = [];
    async function batch(phase: string) {
      return Promise.all(
        Array.from({ length: 20 }, async () => {
          const started = performance.now();
          const response = await f.request(range);
          const wire = await response.text();
          expect(response.status).toBe(200);
          expect(response.headers.get('cache-control')).toBe('private, no-store');
          const parsed = OverviewResponse.parse(JSON.parse(wire));
          expect(parsed.partnerId).toBe(f.partnerId);
          const sample = {
            phase,
            ms: performance.now() - started,
            bytes: Buffer.byteLength(wire),
            value: snapshot(parsed),
          };
          samples.push(sample);
          return sample;
        }),
      );
    }
    for (const read of await batch('candidate')) expect(read.value).toEqual(old);

    // Hold only this new synthetic partner's revision row. Ordinary MVCC readers
    // remain free; the real publisher must wait after inserting its statement.
    const control = await connectTestDatabase();
    const held = latch(),
      release = latch();
    let blockerPid = 0;
    const holding = control.begin(async (tx) => {
      const [pid] = await tx`select pg_backend_pid() as pid`;
      blockerPid = pid.pid;
      await tx`select partner_id from portal_statements.revisions where partner_id=${f.partnerId} for update`;
      held.release();
      await release.promise;
    });
    // Attach rejection handlers immediately; always release and await both tasks.
    const holderResult = holding.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let publication: ReturnType<typeof ready.publish> | undefined;
    let publicationResult: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
    let observedBlocked = false;
    try {
      await Promise.race([
        held.promise,
        holderResult.then((outcome) => {
          if (!outcome.ok) throw outcome.error;
        }),
      ]);
      publication = ready.publish();
      publicationResult = publication.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const deadline = performance.now() + 2500;
      while (performance.now() < deadline) {
        const [waiting] = await control`select exists(select 1 from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock'
          and ${blockerPid} = any(pg_blocking_pids(pid))
          and query like '%insert into portal_statements.revisions%') as blocked`;
        if (waiting.blocked) {
          observedBlocked = true;
          break;
        }
        await Promise.race([
          delay(10),
          publicationResult.then((outcome) => {
            if (!outcome.ok) throw outcome.error;
            throw new Error('Publisher completed before the test observed its lock wait');
          }),
        ]);
      }
      if (!observedBlocked) {
        const waits = await control`select pid,wait_event_type,wait_event,
          pg_blocking_pids(pid) as blockers,left(query,160) as query
          from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;
        process.stdout.write(
          'Synthetic publication lock diagnostic ' + JSON.stringify({ blockerPid, waits }) + '\n',
        );
      }
      expect(observedBlocked).toBe(true);
      // This must execute while an actual separate database transaction is blocked,
      // not merely concurrently scheduled JavaScript that finishes before the read.
      for (const read of await batch('publisher-blocked')) expect(read.value).toEqual(old);
      const [visible] =
        await control`select count(*)::integer as count from portal_statements.statements where partner_id=${f.partnerId}`;
      expect(visible.count).toBe(1);
      const transition = batch('commit-overlap');
      release.release();
      await Promise.all([publication, transition]);
    } finally {
      release.release();
      await holderResult;
      await publicationResult;
      await control.end();
    }
    const after = await f.read(range);
    const current = snapshot(after);
    expect(current.earnings.confirmed?.minor).toBe('30002000');
    expect(current.earnings.eligibleSales?.minor).toBe('300010000');
    expect(current.earnings.channelBreakdown?.organic.minor).toBe('30002000');
    expect(current.earnings.channelBreakdown?.brandAds.minor).toBe('0');
    expect(current.earnings.trend.map((day) => [day.date, day.amount.minor])).toEqual([
      ['2026-08-30', '10001000'],
      ['2026-09-01', '20001000'],
    ]);
    expect(current.earnings.topContent.map((clip) => [clip.id, clip.earned?.minor])).toEqual([
      ['clip-1', '15001000'],
      ['clip-3', '15001000'],
    ]);
    expect(current.earnings.salesByBrand?.map((brand) => [brand.label, brand.value.minor])).toEqual(
      [
        ['Axtion', '150005000'],
        ['Tendrix', '150005000'],
      ],
    );
    expect(current.obligation.confirmedUnpaid?.minor).toBe('30002000');
    expect(current.earnings.generation).not.toBe(old.earnings.generation);
    expect(BigInt(current.earningsRevision)).toBe(BigInt(old.earningsRevision) + 1n);
    expect(BigInt(current.settlementsRevision)).toBe(BigInt(old.settlementsRevision) + 1n);
    for (const read of await batch('committed')) expect(read.value).toEqual(current);
    for (const read of samples) {
      const expected = read.value.earnings.generation === old.earnings.generation ? old : current;
      expect(read.value).toEqual(expected);
    }
    expect((await f.request({ ...range, generation: old.earnings.generation })).status).toBe(409);
    expect((await f.request({ ...range, generation: current.earnings.generation })).status).toBe(
      200,
    );
    const [published] =
      await sql`select count(*)::integer as count from portal_statements.statements where partner_id=${f.partnerId}`;
    expect(published.count).toBe(2);
    const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b);
    const measurement = {
      requests: samples.length,
      concurrency: 20,
      observedBlocked,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxMs: sorted.at(-1),
      maxBytes: Math.max(...samples.map((sample) => sample.bytes)),
      phases: Object.fromEntries(
        ['candidate', 'publisher-blocked', 'commit-overlap', 'committed'].map((phase) => [
          phase,
          {
            old: samples.filter(
              (sample) =>
                sample.phase === phase &&
                sample.value.earnings.generation === old.earnings.generation,
            ).length,
            new: samples.filter(
              (sample) =>
                sample.phase === phase &&
                sample.value.earnings.generation === current.earnings.generation,
            ).length,
          },
        ]),
      ),
    };
    process.stdout.write('Publication overlap measurement ' + JSON.stringify(measurement) + '\n');
    expect(measurement.p95Ms).toBeLessThanOrEqual(500);
    expect(measurement.maxBytes).toBeLessThanOrEqual(100000);
  });
});
