import type { z } from 'zod';
import { AdCommission, type ConnectedAdsValue } from '@/contracts/connected-ad-earnings';
import { getAdOrderSummary } from '@/features/content/ad-order-summary';
import type { DatasetRecords } from './dataset';

/** Integer arithmetic, one rounding at satang; provider decimals never pass through Number. */
export function commissionFor(connection: ConnectedAdsValue['connections'][number], period: ConnectedAdsValue['period']): z.infer<typeof AdCommission> {
  const summary = getAdOrderSummary(connection.performance ?? undefined, period);
  const unknown = (reason: string) => ({ amount: null, sales: null, ratePpm: connection.ratePpm, reason, status: 'estimated' as const });
  if (!summary.sales || summary.salesCurrency !== 'THB' || connection.performance?.state !== 'ready')
    return unknown(summary.stale ? 'ยังอัปเดตยอดขายล่าสุดไม่สำเร็จ' : summary.salesReason ?? 'ยังไม่มีรายงานยอดขายครบช่วงที่เลือก');
  const [whole, fraction = ''] = summary.sales.split('.');
  const decimal = BigInt(whole + fraction), scale = 10n ** BigInt(fraction.length);
  const round = (value: bigint, denominator: bigint) => (value * 2n + denominator) / (denominator * 2n);
  const sales = { currency: 'THB' as const, minor: round(decimal * 100n, scale).toString() };
  if (connection.ratePpm === null)
    return { ...unknown('รอยืนยันอัตราคอมมิชชันของโฆษณานี้'), sales };
  return { amount: { currency: 'THB', minor: round(decimal * 100n * BigInt(connection.ratePpm), scale * 1_000_000n).toString() }, sales, ratePpm: connection.ratePpm, reason: null, status: 'estimated' };
}

/** Replace only pending ad samples. Organic and confirmed/settled accounting remain separate facts. */
export function withoutConnectedSamples(dataset: DatasetRecords, ads: ConnectedAdsValue): DatasetRecords {
  const linked = new Set(ads.connections.map(c => c.clipId));
  return { ...dataset, earnings: dataset.earnings.filter(e =>
    !(linked.has(e.contentId) && e.channel === 'brand_ads' && e.status === 'estimated' && !e.released)) };
}

/** A gross source estimate must not be re-added over an already confirmed ad earning. */
export function accountingCommission(dataset: DatasetRecords, connection: ConnectedAdsValue['connections'][number], period: ConnectedAdsValue['period']) {
  const value = commissionFor(connection, period);
  const from = period.from.slice(0, 10), to = period.toExclusive.slice(0, 10);
  if (dataset.earnings.some(e => e.contentId === connection.clipId && e.channel === 'brand_ads' &&
      e.earnedDate >= from && e.earnedDate < to && (e.status === 'confirmed' || e.released)))
    return { ...value, amount: null, reason: 'มีค่าคอมโฆษณาที่ลงบัญชีแล้ว รอตรวจสอบยอดส่วนต่าง' };
  return value;
}
