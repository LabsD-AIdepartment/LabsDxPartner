import { describe, expect, it } from 'vitest';
import type { MoneyValue } from '@/contracts/common';
import type { OverviewValue } from '@/contracts/overview';
import { platformSalesItems } from '@/features/overview/platform-sales';

type Earnings = OverviewValue['earnings'];
type Item = { label: string; value: MoneyValue };

const m = (minor: string): MoneyValue => ({ currency: 'THB', minor });

// The helper only reads `eligibleSales` and `trend`; build just those and cast to the earnings type.
const earnings = (eligibleSales: MoneyValue | null, trend: unknown[] = []): Earnings =>
  ({ eligibleSales, trend } as unknown as Earnings);

const point = (extra: Record<string, unknown> = {}) => ({ date: '2026-08-01', amount: m('0'), ...extra });

const byLabel = (items: Item[] | null) =>
  Object.fromEntries((items ?? []).map((i) => [i.label, i.value.minor] as const));

const total = (items: Item[]) => items.reduce((sum, i) => sum + BigInt(i.value.minor), 0n);

const FB = 'Facebook';
const SHOPEE = 'Shopee';
const TT = 'TikTok';
const LAZADA = 'Lazada';
const WEB = 'Webmarketplace';
const UNATTR = 'ยังไม่ระบุแพลตฟอร์ม';

describe('platformSalesItems', () => {
  it('returns null when the window headline (eligibleSales) is unknown', () => {
    expect(platformSalesItems(earnings(null, [point()]))).toBeNull();
  });

  it('splits a fully-attributed window into named buckets that reconcile to the headline', () => {
    const items = platformSalesItems(
      earnings(m('300'), [
        point({
          sales: m('300'),
          salesByPlatform: [
            { platform: 'facebook', sales: m('100') },
            { platform: 'shopee', sales: m('50') },
            { platform: 'tiktok', sales: m('60') },
            { platform: 'lazada', sales: m('40') },
            { platform: 'web', sales: m('50') },
          ],
        }),
      ]),
    );
    expect(items).not.toBeNull();
    expect(items!.map((i) => i.label)).toEqual([FB, SHOPEE, TT, LAZADA, WEB]);
    expect(byLabel(items)).toEqual({ [FB]: '100', [SHOPEE]: '50', [TT]: '60', [LAZADA]: '40', [WEB]: '50' });
    // Fully attributed: no residual bucket, and the bars sum exactly to the headline.
    expect(items!.some((i) => i.label === UNATTR)).toBe(false);
    expect(total(items!)).toBe(300n);
  });

  it('confirmed 550k daily attribution under a current-inclusive 690k headline yields a 140k residual', () => {
    // Mirrors the partner-demo fixture: trend sales are confirmed-only (55,000,000 satang) while
    // eligibleSales carries the estimated current-period sales (69,000,000 satang).
    const items = platformSalesItems(
      earnings(m('69000000'), [
        point({
          date: '2026-08-01',
          sales: m('55000000'),
          salesByPlatform: [
            { platform: 'facebook', sales: m('20000000') },
            { platform: 'shopee', sales: m('15000000') },
            { platform: 'tiktok', sales: m('10000000') },
            { platform: 'lazada', sales: m('7000000') },
            { platform: 'web', sales: m('3000000') },
          ],
        }),
      ]),
    );
    expect(items).not.toBeNull();
    // The 690k headline must NOT render only the 550k breakdown: 140k lands in the residual bucket.
    expect(byLabel(items)![UNATTR]).toBe('14000000');
    expect(total(items!)).toBe(69000000n);
  });

  it('handles huge satang totals with exact BigInt (no float rounding)', () => {
    const big = 9007199254740993n; // beyond Number.MAX_SAFE_INTEGER
    const items = platformSalesItems(
      earnings(m((big + 1n).toString()), [
        point({ sales: m(big.toString()), salesByPlatform: [{ platform: 'web', sales: m(big.toString()) }] }),
      ]),
    );
    expect(byLabel(items)).toEqual({ [WEB]: big.toString(), [UNATTR]: '1' });
    expect(total(items!)).toBe(big + 1n);
  });

  it('with no source daily attribution, the whole headline is a single unattributed bucket (no fake zeros)', () => {
    const items = platformSalesItems(
      earnings(m('5000'), [point({ sales: null, salesByPlatform: null }), point({ date: '2026-08-02' })]),
    );
    expect(items).toEqual([{ label: UNATTR, value: m('5000') }]);
  });

  it('days with known sales but no platform breakdown roll into the residual, not into named zeros', () => {
    const items = platformSalesItems(
      earnings(m('1000'), [
        point({ date: '2026-08-01', sales: m('400'), salesByPlatform: [{ platform: 'facebook', sales: m('400') }] }),
        // Sales known for the day but the source never attributed a platform.
        point({ date: '2026-08-02', sales: m('600'), salesByPlatform: null }),
      ]),
    );
    // Only Facebook has known coverage; the other named platforms are omitted (no misleading zero).
    expect(items!.map((i) => i.label)).toEqual([FB, UNATTR]);
    expect(byLabel(items)).toEqual({ [FB]: '400', [UNATTR]: '600' });
    expect(total(items!)).toBe(1000n);
  });

  it('shows a genuine zero named bucket when its coverage is truly known', () => {
    // Facebook nets to zero across a +/- correction: coverage is known, so it is shown as 0.
    const items = platformSalesItems(
      earnings(m('0'), [
        point({ date: '2026-08-01', sales: m('50'), salesByPlatform: [{ platform: 'facebook', sales: m('50') }] }),
        point({ date: '2026-08-02', sales: m('-50'), salesByPlatform: [{ platform: 'facebook', sales: m('-50') }] }),
      ]),
    );
    expect(items).toEqual([{ label: FB, value: m('0') }]);
  });

  it('preserves signed corrections and still reconciles to the headline', () => {
    // A cancellation drives Facebook net negative; the residual absorbs the difference to the headline.
    const items = platformSalesItems(
      earnings(m('100'), [
        point({
          date: '2026-08-01',
          sales: m('-40'),
          salesByPlatform: [
            { platform: 'facebook', sales: m('-100') },
            { platform: 'tiktok', sales: m('60') },
          ],
        }),
      ]),
    );
    expect(byLabel(items)).toEqual({ [FB]: '-100', [TT]: '60', [UNATTR]: '140' });
    expect(total(items!)).toBe(100n); // -100 + 60 + 140
  });

  it('fails honestly when confirmed named sales exceed the headline (would need a fake negative residual)', () => {
    expect(
      platformSalesItems(
        earnings(m('300'), [
          point({ sales: m('550'), salesByPlatform: [{ platform: 'facebook', sales: m('550') }] }),
        ]),
      ),
    ).toBeNull();
  });

  it('fails honestly on a duplicated platform within a day', () => {
    expect(
      platformSalesItems(
        earnings(m('2'), [
          point({
            sales: m('2'),
            salesByPlatform: [
              { platform: 'web', sales: m('1') },
              { platform: 'web', sales: m('1') },
            ],
          }),
        ]),
      ),
    ).toBeNull();
  });

  it('fails honestly on a breakdown that does not sum to the daily sales', () => {
    expect(
      platformSalesItems(
        earnings(m('999'), [
          point({
            sales: m('5'),
            salesByPlatform: [
              { platform: 'web', sales: m('1') },
              { platform: 'tiktok', sales: m('1') },
            ],
          }),
        ]),
      ),
    ).toBeNull();
  });

  it('fails honestly on a platform breakdown without a known daily sales figure', () => {
    expect(
      platformSalesItems(
        earnings(m('10'), [point({ sales: null, salesByPlatform: [{ platform: 'web', sales: m('1') }] })]),
      ),
    ).toBeNull();
  });

  it('fails honestly — never throws — on malformed money in the inputs', () => {
    expect(() => {
      expect(platformSalesItems(earnings(m('1.5'), [point()]))).toBeNull();
      expect(
        platformSalesItems(
          earnings(m('100'), [
            point({ sales: m('100'), salesByPlatform: [{ platform: 'web', sales: m('1.5') }] }),
          ]),
        ),
      ).toBeNull();
      expect(
        platformSalesItems(
          earnings(m('100'), [point({ sales: { currency: 'THB', minor: 'x' }, salesByPlatform: [] })]),
        ),
      ).toBeNull();
    }).not.toThrow();
  });

  it('preserves a source-declared signed unattributed correction when the daily sums reconcile', () => {
    // The source itself books a -20 cancellation as an explicit `unattributed` entry, so the day
    // still sums to its 80 sales even though Facebook nets +100. named (100) exceeds the headline
    // (80), but the KNOWN daily total (80) equals it, so this is a verified signed correction — the
    // -20 residual is kept, not rejected as a fake negative.
    const items = platformSalesItems(
      earnings(m('80'), [
        point({
          date: '2026-08-01',
          sales: m('80'),
          salesByPlatform: [
            { platform: 'facebook', sales: m('100') },
            { platform: 'unattributed', sales: m('-20') },
          ],
        }),
      ]),
    );
    expect(byLabel(items)).toEqual({ [FB]: '100', [UNATTR]: '-20' });
    expect(total(items!)).toBe(80n); // 100 + (-20)
  });

  it('treats a negative headline with no daily detail as a known signed total, not unknown', () => {
    // No attribution anywhere: the negative headline stands on its own as the known signed total,
    // so it renders as a single unattributed bucket rather than being suppressed as unavailable.
    const items = platformSalesItems(earnings(m('-500'), [point()]));
    expect(items).toEqual([{ label: UNATTR, value: m('-500') }]);
  });

  it('stays null when known daily sales exceed the headline, even with signed-residual support', () => {
    // named 550 under a headline of 300: the confirmed daily total (550) cannot fit inside the
    // window it describes and nothing declares the difference, so it is an unexplained excess. The
    // new signed-residual support must NOT paper over it with an invented negative remainder.
    expect(
      platformSalesItems(
        earnings(m('300'), [
          point({ date: '2026-08-01', sales: m('550'), salesByPlatform: [{ platform: 'facebook', sales: m('550') }] }),
        ]),
      ),
    ).toBeNull();
  });

  it('returns a known-empty list ([]) when the headline is a known zero with no attribution', () => {
    // Known headline that maps to nothing is empty-but-known ([]), distinct from an unknown
    // headline (null). Preserving that distinction lets the UI tell "no sales" from "unavailable".
    expect(platformSalesItems(earnings(m('0'), [point()]))).toEqual([]);
  });
});
