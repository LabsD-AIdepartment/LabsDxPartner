import { describe, expect, it } from 'vitest';
import { createOverviewReader } from '@/server/modules/earnings/overview';

const m = (minor: string) => ({ currency: 'THB' as const, minor });

/**
 * Native-reader MAPPING test. It drives {@link createOverviewReader} with a mocked `tx` returning a
 * single crafted MVCC row — it verifies the JS that maps the query result into the Overview contract
 * (specifically the new daily `sales` + unattributed `salesByPlatform` subtotal). It does NOT run any
 * SQL, so it is not evidence of database integration.
 */
const row = {
  publication_count: 1,
  through: '2026-08-01T00:00:00Z',
  as_of: '2026-08-02T00:00:00Z',
  periods: [
    { from: '2026-08-01T00:00:00+07:00', toExclusive: '2026-08-02T00:00:00+07:00', timezone: 'Asia/Bangkok' },
  ],
  totals: {
    confirmed: '3',
    sales: '15',
    unassigned: '0',
    content_count: 0,
    organic: '0',
    ads: '0',
    other: '3',
    organic_rate: null,
    ads_rate: null,
    missing_sales_brand: 0,
  },
  excluded: 0,
  missing_metadata: 0,
  unknown_brand: 0,
  days: [{ date: '2026-08-01', minor: '3', sales_minor: '15' }],
  sales_by_brand: [],
  brands: [],
  top_clips: [],
  balance_count: 0,
  outstanding: '0',
  has_credit: false,
  next: null,
  profile: null,
  catalogue_revision: '1',
  statements_revision: '1',
  earnings_revision: '1',
  settlements_revision: '1',
};

const access = {
  withPartner: async (
    _headers: Headers,
    partnerId: string,
    _capability: string,
    run: (tx: { unsafe: () => Promise<unknown[]> }, scope: unknown) => Promise<unknown>,
  ) =>
    run({ unsafe: async () => [row] }, {
      partnerId,
      permissionRevision: 'p1:m1',
      capabilities: ['view_earnings'],
    }),
} as unknown as Parameters<typeof createOverviewReader>[0];

describe('createOverviewReader maps daily eligible-base into an unattributed sales subtotal', () => {
  it('emits per-day sales and a single unattributed platform subtotal for known days', async () => {
    const read = createOverviewReader(access);
    const result = (await read(new Headers(), {
      partnerId: 'partner-1',
      permissionRevision: 'p1:m1',
      from: '2026-08-01',
      toExclusive: '2026-08-02',
    })) as { data: { earnings: { trend: unknown[] } } };
    expect(result.data.earnings.trend).toEqual([
      {
        date: '2026-08-01',
        amount: m('3'),
        sales: m('15'),
        salesByPlatform: [{ platform: 'unattributed', sales: m('15') }],
      },
    ]);
  });
});
