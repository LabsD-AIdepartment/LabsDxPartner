import { describe, expect, it } from 'vitest';
import { scenario, scenarioNames } from '../../dev/scenarios';
import { Overview } from '@/contracts/overview';
import { EarningsLine, EarningsResponse, AgreementVersion } from '@/contracts/earnings';
import {
  ContentListResponse,
  ContentDetailResponse,
  AdDetailResponse,
  AdListResponse,
  Metric,
} from '@/contracts/content';
import { Statement, StatementList, StatementDetail, Settlement } from '@/contracts/statements';
import { Session } from '@/contracts/session';
import { Account } from '@/contracts/account';
import { Notifications } from '@/contracts/notifications';
import { Changes } from '@/contracts/changes';
import { Money, QueryFilters } from '@/contracts/common';
import { calculateAgreementGroup } from '@/server/modules/earnings/reconcile';

describe('public partner wire contract', () => {
  for (const name of scenarioNames)
    it(`parses the complete ${name} scenario`, () => {
      const s = scenario(name);
      for (const [schema, data] of [
        [Overview, s.overview],
        [EarningsResponse, s.earnings],
        [ContentListResponse, s.content],
        [ContentDetailResponse, s.contentDetail],
        [AdDetailResponse, s.ad],
        [AdListResponse, s.ads],
        [StatementList, s.statements],
        [StatementDetail, s.statement],
        [Session, s.session],
        [Account, s.account],
        [Notifications, s.notifications],
        [Changes, s.changes],
      ] as const)
        expect(schema.safeParse(data).success).toBe(true);
    });
  it('all scenario summary earnings reconcile to the same-generation rows', () => {
    for (const name of scenarioNames) {
      const s = scenario(name);
      if (name === 'unavailable') {
        expect(s.overview.earnings.confirmed).toBeNull();
        expect(s.overview.earnings.coverage.status).toBe('unavailable');
        continue;
      }
      expect(
        s.earnings.data.items.reduce((a, x) => a + BigInt(x.amount.minor), 0n).toString(),
      ).toBe(s.overview.earnings.confirmed?.minor);
    }
  });
  it('rejects float, malformed, unknown currency and leaked internal fields', () => {
    for (const value of [
      { currency: 'THB', minor: 0.1 },
      { currency: 'THB', minor: '1.5' },
      { currency: 'THB', minor: '01' },
      { currency: 'USD', minor: '10' },
      { currency: 'THB', minor: '-0' },
      { currency: 'THB', minor: '1', customerPhone: 'private' },
    ])
      expect(Money.safeParse(value).success).toBe(false);
  });
  it('does not permit guessed fixed-fee sales or missing adjustment provenance', () => {
    const line = scenario('ready').earnings.data.items[0];
    expect(EarningsLine.safeParse({ ...line, kind: 'fixed-fee' }).success).toBe(false);
    expect(
      EarningsLine.safeParse({ ...line, kind: 'fixed-fee', eligibleBase: null, ratePpm: null })
        .success,
    ).toBe(true);
    expect(
      EarningsLine.safeParse({ ...line, kind: 'adjustment', status: 'adjustment' }).success,
    ).toBe(false);
  });
  it('separates current obligation from draft earnings generation', () => {
    const s = scenario('ready');
    s.overview.obligation.asOf = '2026-09-02T12:00:00+07:00';
    s.overview.obligation.confirmedUnpaid = { currency: 'THB', minor: '1952000' };
    expect(Overview.safeParse(s.overview).success).toBe(true);
    expect(s.overview.earnings.generation).toBe('1');
  });
  it('rejects an unbalanced statement or settlement', () => {
    const s = scenario('ready');
    expect(
      Statement.safeParse({ ...s.statement.statement, closing: { currency: 'THB', minor: '0' } })
        .success,
    ).toBe(false);
    expect(
      Settlement.safeParse({
        ...s.statement.settlements.items[0],
        withholding: { currency: 'THB', minor: '200' },
      }).success,
    ).toBe(false);
  });
  it('dispatches the agreement rounding mode explicitly', () => {
    const agreement = AgreementVersion.parse(scenario('ready').account.agreement);
    const lines = [
      { id: 'a', base: 5n },
      { id: 'b', base: 5n },
      { id: 'c', base: 5n },
    ];
    expect(calculateAgreementGroup({ agreement, ratePpm: 100000, lines }).total).toBe(3n);
    expect(
      calculateAgreementGroup({
        agreement: {
          ...agreement,
          roundingRule: {
            mode: 'per-period',
            tieBreak: 'half-away-from-zero',
            allocation: 'largest-remainder-stable-id',
          },
        },
        ratePpm: 100000,
        lines,
      }).rows,
    ).toEqual({ a: 1n, b: 1n, c: 0n });
  });
  it('bounds interactive queries and rejects additive reach', () => {
    expect(
      QueryFilters.safeParse({ from: '2020-01-01', toExclusive: '2026-01-01', brand: null })
        .success,
    ).toBe(false);
    const metric = scenario('ready').ad.data.metrics[0];
    expect(Metric.safeParse({ ...metric, key: 'reach', additive: true }).success).toBe(false);
  });
});
