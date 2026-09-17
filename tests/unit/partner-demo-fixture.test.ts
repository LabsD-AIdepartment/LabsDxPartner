import { describe, expect, it } from 'vitest';
import {
  DEMO_FINANCIALS,
  currentPeriodPendingMinor,
  septemberEstimatedLines,
} from '../../dev/scenarios/demo-financials';
import { getScenario } from '../../dev/withdrawals/scenarios';
import { overviewFixture, overviewRows } from '../../dev/overview-transport';
import { contentFixture } from '../../dev/content-transport';
import { readyScenario } from '../../dev/scenarios/ready';

const sumMinor = (values: { minor: string }[]) =>
  values.reduce((total, v) => total + BigInt(v.minor), 0n);

describe('demo-financials is derived from the ready statement and reconciles', () => {
  it('opening figures come from readyScenario().statement and released − settled = available', () => {
    const statement = readyScenario().statement.statement;
    expect(DEMO_FINANCIALS.confirmedReleasedMinor).toBe(statement.newEarnings.minor);
    expect(DEMO_FINANCIALS.settledMinor).toBe(statement.settled.minor);
    expect(DEMO_FINANCIALS.openingAvailableMinor).toBe(statement.closing.minor);
    expect(
      BigInt(DEMO_FINANCIALS.confirmedReleasedMinor) - BigInt(DEMO_FINANCIALS.settledMinor),
    ).toBe(BigInt(DEMO_FINANCIALS.openingAvailableMinor));
    expect(DEMO_FINANCIALS.openingAvailableMinor).toBe('2552000'); // 25,520.00
  });
  it('current-period pending is the sum of the September estimated lines (7,000.00)', () => {
    expect(currentPeriodPendingMinor).toBe(sumMinor(septemberEstimatedLines.map((l) => l.amount)).toString());
    expect(currentPeriodPendingMinor).toBe('700000');
  });
});

describe('partner-demo withdrawal scenario mirrors the same authority', () => {
  const scenario = getScenario('partner-demo');
  it('released/settled/pending match demo-financials and source periods reconcile to statement-1', () => {
    expect(scenario.base.released).toBe(DEMO_FINANCIALS.confirmedReleasedMinor);
    expect(scenario.base.settled).toBe(DEMO_FINANCIALS.settledMinor);
    expect(scenario.currentPeriodPending).toBe(currentPeriodPendingMinor);
    expect(sumMinor(scenario.base.sourcePeriods.map((p) => ({ minor: p.amount }))).toString()).toBe(
      scenario.base.released,
    );
    expect(scenario.base.sourcePeriods[0].statementId).toBe(DEMO_FINANCIALS.statementId);
  });
  it('opens with zero reserved/held and a null persistenceNote (no real fault)', () => {
    expect(scenario.base.held).toBe('0');
    expect(scenario.deduction).toEqual({ kind: 'none' });
    expect(scenario.persistenceNote).toBeNull();
  });
});

describe('partner-demo Overview is current-inclusive but leaves legacy Jul–Aug untouched', () => {
  const brand = null;
  it('July 1 – Oct 1 shows nonzero estimated pending and confirmed released', () => {
    const data = overviewFixture(
      { from: '2026-07-01', toExclusive: '2026-10-01', brand },
      'partner-demo',
    );
    expect(data.earnings.confirmed?.minor).toBe(DEMO_FINANCIALS.confirmedReleasedMinor);
    expect(data.earnings.estimated?.minor).toBe(currentPeriodPendingMinor);
    // Eligible sales include the September estimated commission base (55,000 + 14,000 THB).
    expect(data.earnings.eligibleSales?.minor).toBe('69000000');
    // Obligation confirmed-unpaid equals the opening available balance (cross-page coherence).
    expect(data.obligation.confirmedUnpaid?.minor).toBe(DEMO_FINANCIALS.openingAvailableMinor);
  });
  it('explicit Jul–Aug selection is naturally estimated 0 and unchanged from ready', () => {
    const demo = overviewFixture(
      { from: '2026-07-01', toExclusive: '2026-09-01', brand },
      'partner-demo',
    );
    const ready = overviewFixture({ from: '2026-07-01', toExclusive: '2026-09-01', brand }, 'ready');
    expect(demo.earnings.estimated?.minor).toBe('0');
    expect(demo.earnings.confirmed?.minor).toBe(ready.earnings.confirmed?.minor);
    expect(demo.earnings.eligibleSales?.minor).toBe(ready.earnings.eligibleSales?.minor);
  });
  it('confirmed channel rates stay clean (organic 10% / brand ads 3%) with estimated rows present', () => {
    const data = overviewFixture(
      { from: '2026-07-01', toExclusive: '2026-10-01', brand },
      'partner-demo',
    );
    expect(data.earnings.channelBreakdown?.organicRatePpm).toBe(100000);
    expect(data.earnings.channelBreakdown?.brandAdsRatePpm).toBe(30000);
  });
  it('watermarks (generatedAt/dataThrough) are the Sep 16 asOf, not predating September rows', () => {
    const data = overviewFixture(
      { from: '2026-07-01', toExclusive: '2026-10-01', brand },
      'partner-demo',
    );
    expect(data.generatedAt).toBe(DEMO_FINANCIALS.asOf);
    expect(data.dataThrough).toBe(DEMO_FINANCIALS.asOf);
  });
  it('preserves the ready line earned dates/amounts so rows match the retained statement exactly', () => {
    const { rows } = overviewRows({ from: '2026-07-01', toExclusive: '2026-10-01', brand }, 'partner-demo');
    for (const line of readyScenario().statement.lines.items) {
      const row = rows.find((r) => r.sourceRef === line.sourceRef);
      expect(row?.earnedAt).toBe(line.earnedAt);
      expect(row?.amount.minor).toBe(line.amount.minor);
    }
  });
});

describe('partner-demo content lists the September open-period clips coherently', () => {
  it('includes the September clips for a current-inclusive range', () => {
    const list = contentFixture(
      {
        resource: 'list',
        context: {
          from: '2026-07-01',
          toExclusive: '2026-10-01',
          brand: null,
          q: '',
          cursor: null,
          generation: null,
          history: [],
          origin: 'content',
        },
      } as unknown as Parameters<typeof contentFixture>[0],
      'partner-demo',
    );
    const items = (list.data as { items: { id: string }[] }).items;
    const ids = items.map((c) => c.id);
    expect(ids).toContain('clip-sep-1');
    expect(ids).toContain('clip-sep-2');
  });
  it('marks a September (open-period) clip detail as estimated, not mixed or confirmed', () => {
    const detail = contentFixture(
      {
        resource: 'detail',
        contentId: 'clip-sep-1',
        context: {
          from: '2026-07-01',
          toExclusive: '2026-10-01',
          brand: null,
          q: '',
          cursor: null,
          generation: null,
          history: [],
          origin: 'content',
        },
      } as unknown as Parameters<typeof contentFixture>[0],
      'partner-demo',
    );
    expect((detail.data as { earningsStatus: string }).earningsStatus).toBe('estimated');
  });
});
