// Development-only PURE projections of the coherent partner-demo dataset into the EXISTING product
// contracts. Every projection returns an object already validated by the product contract (`*.parse`),
// so a drift fails loudly at the boundary rather than rendering a wrong number. Nothing here imports a
// node builtin or the server DB, so Astra's browser `client.ts` can import it directly.
//
// The one authority is the normalized `DatasetRecords` (dataset.ts). Totals are COMPUTED from rows,
// never restated. Monetary projections optionally accept a controller overlay (`WithdrawalRow[]`) so
// statements/documents/obligation reflect the live settlements the withdrawal controller records; the
// overlay is folded over the DB withdrawals (dedupe by requestRef) and settlements are RE-DERIVED from
// the paid set, so a replayed/late request can never double-count. No overlay ⇒ the DB rows stand.
//
// Ad-performance monetary metrics (platform_value / spend / roas) are DB-authored or explicitly
// `unavailableReason` — NEVER the old hardcoded fixture numbers. The single statement id is
// `statement-1`; there is NO fake June `statement-previous` (no such row is seeded).

import { Overview, type OverviewValue, type SalesPlatformName } from '@/contracts/overview';
import {
  ContentListResponse,
  ContentDetailResponse,
  AdListResponse,
  AdDetailResponse,
} from '@/contracts/content';
import { EarningsResponse } from '@/contracts/earnings';
import { StatementListResponse, StatementDetailResponse } from '@/contracts/statements';
import { coverageForPeriod } from '@/contracts/coverage';
import { applyAdSample } from '../ad-sample-media';
import {
  CLOSED_PERIOD,
  CLOSED_STATEMENT_ID,
  addDays,
  type Channel,
  type DatasetRecords,
  type EarningRow,
  type SettlementRow,
  type WithdrawalRow,
} from './dataset';

// ---- small helpers ----------------------------------------------------------------------

type Minor = string;
interface Money {
  currency: 'THB';
  minor: Minor;
}
const money = (minor: bigint | string): Money => ({
  currency: 'THB',
  minor: typeof minor === 'bigint' ? minor.toString() : minor,
});
const sumMinor = (values: readonly { minor: string }[]): bigint =>
  values.reduce((total, v) => total + BigInt(v.minor), 0n);

// Fixed display order so a day's platform breakdown is deterministic (matches the accepted overview).
const PLATFORM_ORDER: SalesPlatformName[] = [
  'facebook',
  'tiktok',
  'shopee',
  'lazada',
  'web',
  'unattributed',
];

// The controller's active statuses hold a reservation; paid converts to settlement; the rest hold
// nothing. Kept identical to the withdrawal contract's request-status set.
const ACTIVE_WITHDRAWAL = new Set(['requested', 'processing', 'reconciling']);

// A within-window earned INSTANT for a Bangkok calendar date. The current day (== anchorDate) is
// clamped to 00:00+07:00 so a noon instant never lands after `asOf`; earlier days use noon (a stable
// within-day instant). No earned instant is ever after asOf.
function earnedInstant(date: string, anchorDate: string): string {
  return date >= anchorDate ? `${date}T00:00:00+07:00` : `${date}T12:00:00+07:00`;
}

// A published INSTANT for a clip's calendar date (same current-day clamp as earnings).
function publishedInstant(date: string, anchorDate: string): string {
  return date >= anchorDate ? `${date}T00:00:00+07:00` : `${date}T12:00:00+07:00`;
}

function freshnessOf(dataset: DatasetRecords, requestId: string) {
  return {
    dataState: 'ready' as const,
    generatedAt: dataset.meta.asOf,
    dataThrough: dataset.meta.asOf,
    reasons: [] as string[],
    requestId,
    generation: dataset.meta.generation,
  };
}

function periodOf(from: string, toExclusive: string) {
  return {
    from: `${from}T00:00:00+07:00`,
    toExclusive: `${toExclusive}T00:00:00+07:00`,
    timezone: 'Asia/Bangkok' as const,
  };
}

// The single AUTHORITATIVE seeded coverage interval: from the closed period's start through the day
// AFTER the anchor (so the current day is fully covered). This is DECLARED seed coverage — it is not
// inferred from sparse event dates. `coverageForPeriod` clips the requested window to it, so a window
// outside the authored period reports partial/unavailable (unknown) rather than a fabricated zero,
// while requested days INSIDE it are complete (a genuine zero day still renders as 0, not a gap).
function seedCoverageWindow(dataset: DatasetRecords) {
  return {
    from: CLOSED_PERIOD.from,
    toExclusive: `${addDays(dataset.meta.anchorDate, 1)}T00:00:00+07:00`,
    timezone: 'Asia/Bangkok' as const,
  };
}

// ---- overlay folding: getEffectiveDataset ----------------------------------------------

/**
 * Apply the controller's CURRENT withdrawal records (mapped to `WithdrawalRow[]`) as the COMPLETE
 * authoritative withdrawal set: the overlay fully REPLACES the DB withdrawals (a seed row the overlay
 * omits is a genuine withdrawal, never resurrected). Each overlay row must be in scope
 * (datasetId/generation) and requestRef-unique, else we throw at the boundary rather than miscount.
 * Settlements are RE-DERIVED from the paid set, conservation invariants run, and a NEW DatasetRecords
 * is returned. No overlay ⇒ `dataset` verbatim (the initial, pre-controller seed story stands).
 */
export function getEffectiveDataset(
  dataset: DatasetRecords,
  overlay?: WithdrawalRow[],
): DatasetRecords {
  if (!overlay) return dataset;

  // The overlay is complete and authoritative: it REPLACES the DB withdrawals verbatim (no absent-seed
  // resurrection). Reject any row outside this dataset's scope or a replayed/duplicate requestRef.
  const seen = new Set<string>();
  for (const row of overlay) {
    if (row.datasetId !== dataset.meta.datasetId || row.generation !== dataset.meta.generation)
      throw new Error(
        `getEffectiveDataset: overlay row ${row.requestRef} is out of scope (${row.datasetId}/${row.generation})`,
      );
    if (seen.has(row.requestRef))
      throw new Error(`getEffectiveDataset: duplicate overlay requestRef ${row.requestRef}`);
    seen.add(row.requestRef);
  }
  const withdrawals: WithdrawalRow[] = [...overlay];

  // Settlements are a pure projection of the PAID set (its recorded paidAt is the settlement instant).
  const paid = withdrawals.filter((w) => w.status === 'paid');
  const settlements: SettlementRow[] = paid.map((w) => ({
    datasetId: dataset.meta.datasetId,
    generation: dataset.meta.generation,
    id: `${w.requestRef}-settlement`,
    statementId: CLOSED_STATEMENT_ID,
    settlementId: `${w.requestRef}-payment`,
    reference: `${w.requestRef}-transfer`,
    recordedAt: w.paidAt ?? dataset.meta.asOf,
    cashMinor: w.netMinor,
    withholdingMinor: '0',
    otherMinor: '0',
    obligationSettledMinor: w.grossMinor,
    withdrawalRef: w.requestRef,
  }));

  // Conservation: settled (paid gross) + reserved (active gross) must never exceed the released pool.
  const releasedPool = dataset.earnings
    .filter((e) => e.released)
    .reduce((t, e) => t + BigInt(e.amountMinor), 0n);
  const settled = paid.reduce((t, w) => t + BigInt(w.grossMinor), 0n);
  const reserved = withdrawals
    .filter((w) => ACTIVE_WITHDRAWAL.has(w.status))
    .reduce((t, w) => t + BigInt(w.grossMinor), 0n);
  if (settled + reserved > releasedPool)
    throw new Error(
      `getEffectiveDataset: settled(${settled}) + reserved(${reserved}) exceeds released pool ${releasedPool}`,
    );

  // The statement's settlement watermark advances to the latest recorded settlement (or asOf).
  const latestSettlementAt = settlements.reduce(
    (latest, s) => (Date.parse(s.recordedAt) > Date.parse(latest) ? s.recordedAt : latest),
    dataset.statements[0]?.settlementAsOf ?? dataset.meta.asOf,
  );
  const statements = dataset.statements.map((s) =>
    s.statementId === CLOSED_STATEMENT_ID ? { ...s, settlementAsOf: latestSettlementAt } : s,
  );

  return { ...dataset, withdrawals, settlements, statements };
}

// ---- overview ---------------------------------------------------------------------------

interface OverviewFilters {
  from: string;
  toExclusive: string;
  brand?: string | null;
}

/** Selected-period Overview: confirmed/estimated/channels/brand-sales/daily trend/top content, plus
 * the cumulative (filter-independent) obligation derived from the effective statement settlements. */
export function projectOverview(
  dataset: DatasetRecords,
  filters: OverviewFilters,
  overlay?: WithdrawalRow[],
): OverviewValue {
  const eff = getEffectiveDataset(dataset, overlay);
  const anchor = eff.meta.anchorDate;
  const period = periodOf(filters.from, filters.toExclusive);
  const coverage = coverageForPeriod(period, [seedCoverageWindow(eff)]);

  // A requested window entirely OUTSIDE the authored seed coverage is genuinely UNKNOWN. The Overview
  // contract then requires the confirmed projection (and every derived figure) to be null — never a
  // fabricated zero. No earnings row exists outside the seed period, so no actual positive point is
  // suppressed here; the cumulative obligation stays filter-independent.
  if (coverage.status === 'unavailable') {
    const { dataState, generatedAt, dataThrough, reasons, requestId, generation } = freshnessOf(
      eff,
      'demo-overview-request',
    );
    return Overview.parse({
      dataState,
      generatedAt,
      dataThrough,
      reasons,
      requestId,
      brands: [...new Set(eff.clips.map((c) => c.brand))],
      earnings: {
        generation,
        period,
        coverage,
        estimated: null,
        confirmed: null,
        eligibleSales: null,
        unassignedAmount: null,
        excludedCount: null,
        salesByBrand: null,
        channelBreakdown: null,
        contentCount: null,
        trend: [],
        topContent: [],
      },
      obligation: obligationOf(eff),
    });
  }

  const brandOf = clipBrandMap(eff);

  const rows = eff.earnings.filter(
    (e) =>
      e.earnedDate >= filters.from &&
      e.earnedDate < filters.toExclusive &&
      (!filters.brand || brandOf.get(e.contentId) === filters.brand),
  );
  const confirmed = rows.filter((e) => e.status !== 'estimated');
  const estimated = rows.filter((e) => e.status === 'estimated');

  // Channel sums + rates are derived from CONFIRMED lines only (an estimated line never contaminates a
  // published rate). A channel with a single distinct rate publishes it; otherwise the rate is null.
  const channelSum = (channel: Channel) =>
    money(sumMinor(confirmed.filter((e) => e.channel === channel).map((e) => money(e.amountMinor))));
  const channelRate = (channel: Channel): number | null => {
    const rates = new Set(confirmed.filter((e) => e.channel === channel).map((e) => e.ratePpm));
    return rates.size === 1 ? [...rates][0] : null;
  };

  // Sales-by-brand: eligible base of CONFIRMED commission lines only, by clip brand. These sales are
  // the amounts the UI pairs with the confirmed commission label ('ยอดขายที่ยืนยันแล้ว'), so an
  // estimated base must never leak in and be read as a confirmed sale.
  const brandLabels = [...new Set(confirmed.map((e) => brandOf.get(e.contentId)).filter(Boolean))] as string[];
  const salesByBrand = brandLabels
    .map((label) => ({
      label,
      value: money(
        sumMinor(
          confirmed
            .filter((e) => e.kind === 'commission' && brandOf.get(e.contentId) === label)
            .map((e) => money(e.eligibleBaseMinor)),
        ),
      ),
    }))
    .sort((a, b) =>
      BigInt(a.value.minor) > BigInt(b.value.minor)
        ? -1
        : BigInt(a.value.minor) < BigInt(b.value.minor)
          ? 1
          : a.label.localeCompare(b.label),
    );

  // Daily sales + synthetic platform split are built from CONFIRMED commission lines only, so the
  // displayed daily sales / platform bars are exactly the sales paired with the confirmed daily amount
  // ('ยอดขายที่ยืนยันแล้ว'). An estimated commission never lifts a confirmed daily sale, so the paired
  // amount and sales stay coherent (and >= the owner's 3% floor). Estimated bases remain exposed on the
  // estimated earning lines / earnings detail, never mislabeled here as confirmed sales.
  // Grouped by earned date; sparse (only days with a confirmed commission line). The weekly card
  // zero-fills the remaining days from `coverage` downstream, so a genuine zero day still renders as 0.
  const byDate = new Map<string, { amount: bigint; sales: bigint; platforms: Map<SalesPlatformName, bigint> }>();
  for (const line of confirmed.filter((e) => e.kind === 'commission')) {
    const bucket =
      byDate.get(line.earnedDate) ??
      { amount: 0n, sales: 0n, platforms: new Map<SalesPlatformName, bigint>() };
    bucket.amount += BigInt(line.amountMinor);
    const base = BigInt(line.eligibleBaseMinor);
    bucket.sales += base;
    for (const part of allocatePlatforms(eff, line.sourceRef, base))
      bucket.platforms.set(part.platform, (bucket.platforms.get(part.platform) ?? 0n) + part.minor);
    byDate.set(line.earnedDate, bucket);
  }
  const trend = [...byDate.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const bucket = byDate.get(date)!;
      return {
        date,
        amount: money(bucket.amount),
        sales: money(bucket.sales),
        salesByPlatform: PLATFORM_ORDER.filter((p) => (bucket.platforms.get(p) ?? 0n) !== 0n).map(
          (p) => ({ platform: p, sales: money(bucket.platforms.get(p) ?? 0n) }),
        ),
      };
    });

  // Top content = the same clips shown in Content for the same scope, ranked by confirmed earned.
  const topContent = eff.clips
    .filter((clip) => confirmed.some((e) => e.contentId === clip.contentId))
    .map((clip) =>
      applyAdSample({
        id: clip.contentId,
        title: clip.title,
        brand: clip.brand,
        publishedAt: publishedInstant(clip.publishedDate, anchor),
        cover: clip.cover,
        coverPosition: clip.coverPosition,
        removed: clip.removed,
        // Audience view counts are never presented publicly (parity with the real server read-models
        // which already emit views: null); the raw count stays in the demo store, masked here.
        views: null,
        earned: money(
          sumMinor(
            confirmed.filter((e) => e.contentId === clip.contentId).map((e) => money(e.amountMinor)),
          ),
        ),
        unavailableReason: null as string | null,
      }),
    )
    .sort((a, b) =>
      BigInt(a.earned.minor) > BigInt(b.earned.minor)
        ? -1
        : BigInt(a.earned.minor) < BigInt(b.earned.minor)
          ? 1
          : a.id.localeCompare(b.id),
    )
    .slice(0, 3);

  const obligation = obligationOf(eff);
  const { dataState, generatedAt, dataThrough, reasons, requestId, generation } = freshnessOf(
    eff,
    'demo-overview-request',
  );

  return Overview.parse({
    dataState,
    generatedAt,
    dataThrough,
    reasons,
    requestId,
    brands: [...new Set(eff.clips.map((c) => c.brand))],
    earnings: {
      generation,
      period,
      coverage,
      estimated: money(sumMinor(estimated.map((e) => money(e.amountMinor)))),
      confirmed: money(sumMinor(confirmed.map((e) => money(e.amountMinor)))),
      eligibleSales: money(
        sumMinor(confirmed.filter((e) => e.kind === 'commission').map((e) => money(e.eligibleBaseMinor))),
      ),
      unassignedAmount: money(
        sumMinor(confirmed.filter((e) => e.attribution === 'partner-only').map((e) => money(e.amountMinor))),
      ),
      excludedCount: 0,
      salesByBrand,
      channelBreakdown: {
        organic: channelSum('organic'),
        brandAds: channelSum('brand_ads'),
        other: money('0'),
        organicRatePpm: channelRate('organic'),
        brandAdsRatePpm: channelRate('brand_ads'),
      },
      contentCount: new Set(confirmed.map((e) => e.contentId)).size,
      trend,
      topContent,
    },
    obligation,
  });
}

// The cumulative, filter-INDEPENDENT obligation: statement-1's closing (released − settled) drives
// confirmedUnpaid + the next payout. An exhausted (closing 0) statement carries no next payout.
function obligationOf(eff: DatasetRecords) {
  const bridge = statementBridge(eff);
  const asOf = eff.meta.asOf;
  const positive = bridge.closing > 0n;
  return {
    asOf,
    confirmedUnpaid: money(bridge.closing > 0n ? bridge.closing : 0n),
    nextPayoutReason: null,
    nextPayout: positive
      ? {
          statementId: CLOSED_STATEMENT_ID,
          scheduledAt: bridge.settlementAsOf,
          amount: money(bridge.closing),
          period: periodOf(CLOSED_PERIOD.from.slice(0, 10), CLOSED_PERIOD.toExclusive.slice(0, 10)),
        }
      : null,
  };
}

// ---- statement bridge (shared by overview obligation + transactions + documents) --------

interface StatementBridge {
  opening: bigint;
  newEarnings: bigint;
  adjustments: bigint;
  settled: bigint;
  closing: bigint;
  status: 'pending' | 'part-paid' | 'paid' | 'credit';
  settlementAsOf: string;
}

function statementBridge(eff: DatasetRecords): StatementBridge {
  const row = eff.statements.find((s) => s.statementId === CLOSED_STATEMENT_ID);
  const opening = BigInt(row?.openingMinor ?? '0');
  const adjustments = BigInt(row?.adjustmentsMinor ?? '0');
  // newEarnings == the released confirmed pool (statement-1's confirmed commission).
  const newEarnings = eff.earnings
    .filter((e) => e.released)
    .reduce((t, e) => t + BigInt(e.amountMinor), 0n);
  const settled = eff.settlements
    .filter((s) => s.statementId === CLOSED_STATEMENT_ID)
    .reduce((t, s) => t + BigInt(s.obligationSettledMinor), 0n);
  const closing = opening + newEarnings + adjustments - settled;
  const status: StatementBridge['status'] =
    closing < 0n ? 'credit' : closing === 0n ? 'paid' : settled === 0n ? 'pending' : 'part-paid';
  return {
    opening,
    newEarnings,
    adjustments,
    settled,
    closing,
    status,
    settlementAsOf: row?.settlementAsOf ?? eff.meta.asOf,
  };
}

// ---- shared row → contract mappers ------------------------------------------------------

function clipBrandMap(dataset: DatasetRecords): Map<string, string> {
  return new Map(dataset.clips.map((c) => [c.contentId, c.brand]));
}

function allocatePlatforms(
  dataset: DatasetRecords,
  sourceRef: string,
  base: bigint,
): { platform: SalesPlatformName; minor: bigint }[] {
  const allocs = dataset.allocations.filter((a) => a.sourceRef === sourceRef);
  if (allocs.length === 0) return [{ platform: 'unattributed', minor: base }];
  const totalWeight = allocs.reduce((t, a) => t + BigInt(a.weight), 0n);
  const parts = allocs.map((a) => ({ platform: a.platform as SalesPlatformName, minor: (base * BigInt(a.weight)) / totalWeight }));
  // Assign the rounding residual to the first share so the split sums EXACTLY to `base`.
  parts[0].minor += base - parts.reduce((t, p) => t + p.minor, 0n);
  // Merge repeated platforms (e.g. facebook×3 authored as three weight-1 rows) into one subtotal.
  const merged = new Map<SalesPlatformName, bigint>();
  for (const part of parts) merged.set(part.platform, (merged.get(part.platform) ?? 0n) + part.minor);
  return [...merged].map(([platform, minor]) => ({ platform, minor }));
}

// A DB EarningRow → the product EarningsLine shape (within-window instant, exact rate).
function earningsLineOf(row: EarningRow, anchor: string) {
  return {
    id: row.id,
    sourceRef: row.sourceRef,
    sourceRevision: '1',
    agreementVersion: 'synthetic-agreement-1',
    earnedAt: earnedInstant(row.earnedDate, anchor),
    contentId: row.contentId,
    kind: row.kind,
    eligibleBase: money(row.eligibleBaseMinor),
    ratePpm: row.ratePpm,
    amount: money(row.amountMinor),
    status: row.status,
    reason: null,
    evidenceRef: `${row.id}-evidence`,
    originalLineId: null,
    attribution: row.attribution,
  };
}

// ---- content ----------------------------------------------------------------------------

export interface ContentProjectionContext {
  from: string;
  toExclusive: string;
  brand?: string | null;
  q?: string;
  cursor?: string | null;
  generation?: string;
}
export interface ContentProjectionRequest {
  resource: 'list' | 'detail' | 'earnings' | 'ads' | 'ad';
  context: ContentProjectionContext;
  contentId?: string;
  adId?: string;
  cursor?: string | null;
}

export class ContentProjectionError extends Error {
  constructor(
    public code: 'not_found' | 'invalid_input',
    message: string,
  ) {
    super(message);
  }
}

export type ContentProjectionResult =
  | ReturnType<typeof ContentListResponse.parse>
  | ReturnType<typeof ContentDetailResponse.parse>
  | ReturnType<typeof EarningsResponse.parse>
  | ReturnType<typeof AdListResponse.parse>
  | ReturnType<typeof AdDetailResponse.parse>;

const AD_METRIC_UNAVAILABLE = 'ยังไม่มีข้อมูลเชิงโฆษณาสำหรับชุดข้อมูลตัวอย่างนี้';

/** Content list/detail/earnings/ads/ad projection. Same earned-date window / brand / paging / search
 * semantics as the accepted transport; presentation via `applyAdSample` (clip-3 / clip-sep-2). */
export function projectContent(
  dataset: DatasetRecords,
  request: ContentProjectionRequest,
): ContentProjectionResult {
  const anchor = dataset.meta.anchorDate;
  const ctx = request.context;
  const period = periodOf(ctx.from, ctx.toExclusive);
  const coverage = coverageForPeriod(period, [seedCoverageWindow(dataset)]);
  const q = (ctx.q ?? '').toLocaleLowerCase();
  const envelope = { ...freshnessOf(dataset, 'demo-content-request'), period };

  // Earnings rows selected for the window (both confirmed + estimated; content is not paid-only).
  const rows = dataset.earnings.filter(
    (e) => e.earnedDate >= ctx.from && e.earnedDate < ctx.toExclusive,
  );
  const forClip = (contentId: string) => rows.filter((e) => e.contentId === contentId);

  const cards = dataset.clips.map((clip) =>
    applyAdSample({
      id: clip.contentId,
      title: clip.title,
      brand: clip.brand,
      publishedAt: publishedInstant(clip.publishedDate, anchor),
      cover: clip.cover,
      coverPosition: clip.coverPosition,
      removed: clip.removed,
      // Audience view counts are never presented publicly (parity with the real server read-models);
      // the raw count stays in the demo store, masked here.
      views: null,
      // A clip's card shows CONFIRMED commission for the window (estimated-only clips read 0, never a
      // false confirmed); attribution is always content in this dataset so `earned` is never null here.
      earned: money(
        sumMinor(forClip(clip.contentId).filter((e) => e.status !== 'estimated').map((e) => money(e.amountMinor))),
      ),
      unavailableReason: null as string | null,
    }),
  );

  const paginate = <T>(items: T[], resource: string) => {
    const raw = request.cursor === undefined ? (ctx.cursor ?? null) : request.cursor;
    if (raw && !/^offset-\d+$/.test(raw))
      throw new ContentProjectionError('invalid_input', 'หน้ารายการหมดอายุ กรุณากลับหน้าแรก');
    const offset = raw ? Number(raw.slice(7)) : 0;
    const limit = resource === 'list' ? 24 : 2;
    return {
      items: items.slice(offset, offset + limit),
      nextCursor: offset + limit < items.length ? `offset-${offset + limit}` : null,
      totalCount: items.length,
    };
  };

  if (request.resource === 'list') {
    const items = cards.filter(
      (c) =>
        (!ctx.brand || c.brand === ctx.brand) &&
        `${c.title} ${c.brand}`.toLocaleLowerCase().includes(q),
    );
    return ContentListResponse.parse({
      ...envelope,
      coverage,
      brands: [...new Set(dataset.clips.map((c) => c.brand))],
      data: paginate(items, 'list'),
    });
  }

  const clip = cards.find((c) => c.id === request.contentId);
  if (!clip || (ctx.brand && clip.brand !== ctx.brand))
    throw new ContentProjectionError('not_found', 'ไม่พบคลิปนี้ หรือไม่อยู่ในแบรนด์ที่เลือก');
  const selected = forClip(clip.id);

  const ads = adsFor(clip, period, dataset.meta.asOf);

  if (request.resource === 'detail') {
    const hasEstimated = selected.some((e) => e.status === 'estimated');
    const hasConfirmed = selected.some((e) => e.status !== 'estimated');
    return ContentDetailResponse.parse({
      ...envelope,
      coverage,
      data: {
        content: clip,
        sourceUrl: null,
        // Detail eligibleSales is the sale paired with the clip's CONFIRMED commission ('ยอดขายที่
        // ยืนยันแล้ว'), so only confirmed commission bases count; estimated bases stay on the estimated
        // earning lines (earningsStatus below still reflects both statuses).
        eligibleSales: money(
          sumMinor(
            selected
              .filter((e) => e.kind === 'commission' && e.status !== 'estimated')
              .map((e) => money(e.eligibleBaseMinor)),
          ),
        ),
        eligibleOrders: null,
        agreementVersion: selected[0] ? 'synthetic-agreement-1' : null,
        earningsStatus:
          hasEstimated && hasConfirmed ? 'mixed' : hasEstimated ? 'estimated' : 'confirmed',
        metrics: [
          contentMetric('video_views', 'ยอดดูคลิปจากแพลตฟอร์ม เป็นข้อมูลประกอบ ไม่ใช่ยอดรายได้', period, dataset.meta.asOf),
          contentMetric('reach', 'จำนวนผู้ชมไม่ซ้ำ ไม่สามารถรวมจากโฆษณาย่อยได้', period, dataset.meta.asOf),
        ],
        adCount: ads.length,
        attribution: 'content',
      },
    });
  }

  if (request.resource === 'earnings') {
    const lines = selected.map((e) => earningsLineOf(e, anchor));
    return EarningsResponse.parse({
      ...envelope,
      coverage,
      data: { ...paginate(lines, 'earnings'), excludedCount: 0, unassignedAmount: money('0') },
    });
  }

  if (request.resource === 'ads')
    return AdListResponse.parse({ ...envelope, data: paginate(ads, 'ads') });

  const ad = ads.find((a) => a.id === request.adId);
  if (!ad) throw new ContentProjectionError('not_found', 'ไม่พบโฆษณานี้ หรือโฆษณาไม่ได้อยู่ในคลิปที่เลือก');
  return AdDetailResponse.parse({ ...envelope, data: ad });
}

// Ad performance metrics are DB-authored or explicitly UNKNOWN — never the old fixture constants. This
// dataset authors no ad-metric rows, so every metric is `value: null` with a reason (contract-valid).
function contentMetric(
  key: 'video_views' | 'reach',
  definition: string,
  period: ReturnType<typeof periodOf>,
  asOf: string,
) {
  return {
    key,
    value: null,
    unit: 'count' as const,
    definition,
    source: 'demo-dataset',
    period,
    dataThrough: asOf,
    unavailableReason: AD_METRIC_UNAVAILABLE,
    additive: key !== 'reach',
  };
}

function adsFor(
  clip: { id: string; brand: string; removed: boolean },
  period: ReturnType<typeof periodOf>,
  asOf: string,
) {
  const metric = (
    key: 'impressions' | 'link_clicks' | 'reach' | 'platform_orders' | 'platform_value' | 'spend' | 'roas',
    definition: string,
  ) => ({
    key,
    value: null,
    unit: (['spend', 'platform_value'].includes(key) ? 'THB' : key === 'roas' ? 'ratio' : 'count') as
      | 'THB'
      | 'ratio'
      | 'count',
    definition,
    source: 'demo-dataset',
    period,
    dataThrough: asOf,
    unavailableReason: AD_METRIC_UNAVAILABLE,
    additive: key !== 'reach' && key !== 'roas',
  });
  return Array.from({ length: 3 }, (_, i) => ({
    id: `${clip.id}-ad-${i + 1}`,
    contentId: clip.id,
    title: `${clip.brand} · ${['วิดีโอหลัก', 'กลุ่มผู้ชมเพิ่มเติม', 'ทดสอบข้อความ'][i]}`,
    status: (clip.removed ? 'removed' : i === 2 ? 'paused' : 'active') as
      | 'removed'
      | 'paused'
      | 'active',
    asOf,
    metrics: [
      metric('impressions', 'จำนวนครั้งที่โฆษณาแสดง อาจนับคนเดิมได้หลายครั้ง'),
      metric('link_clicks', 'การคลิกลิงก์ตามรายงานแพลตฟอร์ม ไม่ใช่จำนวนคำสั่งซื้อ'),
      metric('reach', 'จำนวนคนที่เข้าถึงในช่วงเวลานี้ ห้ามบวกข้ามโฆษณา'),
      metric('platform_orders', 'คำสั่งซื้อที่แพลตฟอร์มนับตาม attribution window'),
      metric('platform_value', 'มูลค่าที่แพลตฟอร์มรายงาน ไม่ใช่ฐานคำนวณหรือคอมมิชชันพร้อมจ่าย'),
      metric('spend', 'ค่าโฆษณาของแบรนด์ ไม่ได้หักจากคอมมิชชันโดยอัตโนมัติ'),
      metric('roas', 'มูลค่าที่แพลตฟอร์มรายงานเทียบกับค่าโฆษณา ไม่ใช่อัตราคอมมิชชัน'),
    ],
  }));
}

// ---- transactions (statements) ---------------------------------------------------------

export interface TransactionProjectionRequest {
  resource: 'list' | 'detail';
  statementId?: string;
  status?: 'all' | 'pending' | 'part-paid' | 'paid' | 'credit';
}

export class TransactionProjectionError extends Error {
  constructor(
    public code: 'not_found',
    message: string,
  ) {
    super(message);
  }
}

function settlementOf(row: SettlementRow) {
  return {
    id: row.settlementId,
    reference: row.reference,
    recordedAt: row.recordedAt,
    paidAt: row.recordedAt,
    cash: money(row.cashMinor),
    withholding: money(row.withholdingMinor),
    other: money(row.otherMinor),
    obligationSettled: money(row.obligationSettledMinor),
    evidenceRef: `${row.settlementId}-evidence`,
  };
}

function statementDetailData(eff: DatasetRecords) {
  const row = eff.statements.find((s) => s.statementId === CLOSED_STATEMENT_ID)!;
  const bridge = statementBridge(eff);
  const anchor = eff.meta.anchorDate;
  const lines = eff.earnings.filter((e) => e.released).map((e) => earningsLineOf(e, anchor));
  const settlementRows = eff.settlements
    .filter((s) => s.statementId === CLOSED_STATEMENT_ID)
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const settlements = settlementRows.map(settlementOf);
  const statement = {
    id: CLOSED_STATEMENT_ID,
    version: row.version,
    period: periodOf(CLOSED_PERIOD.from.slice(0, 10), CLOSED_PERIOD.toExclusive.slice(0, 10)),
    publishedAt: row.publishedAt,
    scheduledAt: bridge.settlementAsOf,
    settlementAsOf: bridge.settlementAsOf,
    status: bridge.status,
    opening: money(bridge.opening),
    newEarnings: money(bridge.newEarnings),
    adjustments: money(bridge.adjustments),
    settled: money(bridge.settled),
    closing: money(bridge.closing),
  };
  const documents = [
    { id: 'statement-document', statementId: CLOSED_STATEMENT_ID, name: 'ใบสรุปรอบจ่าย · ตัวอย่าง CSV', kind: 'statement' as const },
    ...settlements.map((s) => ({
      id: s.evidenceRef,
      statementId: CLOSED_STATEMENT_ID,
      name: `หลักฐานการชำระ ${s.reference} · ตัวอย่าง CSV`,
      kind: 'payment-evidence' as const,
    })),
  ];
  return {
    statement,
    lines: { items: lines, nextCursor: null, totalCount: lines.length },
    settlements: { items: settlements, nextCursor: null, totalCount: settlements.length },
    documents,
    revision: `settle-rev-${bridge.settled}`,
  };
}

/** Statement list/detail (view=periods). Only the single retained id `statement-1` — never a fake
 * previous. `overlay` folds the live paid settlements into settled/closing/status. */
export function projectTransactions(
  dataset: DatasetRecords,
  request: TransactionProjectionRequest,
  overlay?: WithdrawalRow[],
): ReturnType<typeof StatementListResponse.parse> | ReturnType<typeof StatementDetailResponse.parse> {
  const eff = getEffectiveDataset(dataset, overlay);
  const data = statementDetailData(eff);
  const fresh = {
    dataState: 'ready' as const,
    generatedAt: data.statement.settlementAsOf,
    dataThrough: data.statement.settlementAsOf,
    reasons: [] as string[],
    requestId: 'demo-transactions-request',
  };

  if (request.resource === 'detail') {
    if (request.statementId !== undefined && request.statementId !== CLOSED_STATEMENT_ID)
      throw new TransactionProjectionError('not_found', 'ไม่พบรอบจ่ายนี้');
    return StatementDetailResponse.parse({
      ...fresh,
      settlementsRevision: data.revision,
      data: {
        statement: data.statement,
        lines: data.lines,
        settlements: data.settlements,
        documents: data.documents,
      },
    });
  }

  const items = [data.statement].filter(
    (s) => !request.status || request.status === 'all' || s.status === request.status,
  );
  return StatementListResponse.parse({
    ...fresh,
    settlementsRevision: data.revision,
    asOf: data.statement.settlementAsOf,
    confirmedUnpaid: money(BigInt(data.statement.closing.minor) > 0n ? data.statement.closing.minor : '0'),
    data: { items, nextCursor: null, totalCount: items.length },
  });
}

// ---- documents (statement / payment-evidence CSV) --------------------------------------

/** The exact CSV text for a statement or payment-evidence document, from the SAME scoped effective
 * statement as projectTransactions (so a download matches the displayed revision, byte-for-byte). */
export function projectDocument(
  dataset: DatasetRecords,
  statementId: string,
  documentId: string,
  overlay?: WithdrawalRow[],
): string {
  const eff = getEffectiveDataset(dataset, overlay);
  if (statementId !== CLOSED_STATEMENT_ID)
    throw new TransactionProjectionError('not_found', 'ไม่พบรอบจ่ายนี้');
  const data = statementDetailData(eff);
  if (!data.documents.some((d) => d.id === documentId))
    throw new TransactionProjectionError('not_found', 'ไม่มีสิทธิ์ดาวน์โหลดเอกสารนี้');
  const payment = data.settlements.items.find((s) => s.evidenceRef === documentId);
  return (
    '﻿' +
    [
      'SYNTHETIC SAMPLE ONLY - ไม่ใช่เอกสารการเงินหรือภาษีจริง',
      `statement,${data.statement.id}`,
      `version,${data.statement.version}`,
      `document,${documentId}`,
      'currency,THB',
      ...(['opening', 'newEarnings', 'adjustments', 'settled', 'closing'] as const).map(
        (k) => `${k}_satang,${data.statement[k].minor}`,
      ),
      ...(payment
        ? [
            `payment_reference,${payment.reference}`,
            `paid_at,${payment.paidAt ?? ''}`,
            `recorded_at,${payment.recordedAt}`,
            ...(['cash', 'withholding', 'other', 'obligationSettled'] as const).map(
              (k) => `${k}_satang,${payment[k].minor}`,
            ),
          ]
        : []),
    ].join('\n')
  );
}
