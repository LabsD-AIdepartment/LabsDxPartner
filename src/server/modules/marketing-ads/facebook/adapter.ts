import { z } from 'zod';
import { SourceIdentityV2, ResolvedSourceV2 } from '@/contracts/platform-capabilities';
import {
  ExactDecimal,
  ExactCount,
  SourcePeriod,
  SourceReportV2,
  PlatformMetricV2,
} from '@/contracts/platform-metrics';
import type { MarketingReadAdapter } from '../provider';
import {
  createFacebookGraph,
  FacebookReadError,
  FACEBOOK_VERSION,
  nextFacebookCursor,
  type FacebookReadDependencies,
} from './graph';

export const FacebookConnection = z.strictObject({
  id: z.string().min(1).max(160),
  namespace: z.string().min(1).max(160),
  accountId: z.string().regex(/^\d{1,80}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: SourcePeriod.shape.timezone,
});
type Connection = z.infer<typeof FacebookConnection>;
const NumericId = z.string().regex(/^\d{1,80}$/);
const Account = z.object({
  id: z.string(),
  account_id: NumericId,
  currency: z.string(),
  timezone_name: z.string(),
});
const Ad = z.object({
  id: NumericId,
  account_id: NumericId,
  name: z.string().min(1).max(500),
  effective_status: z.string(),
  updated_time: z.string().optional(),
  creative: z
    .object({
      id: NumericId,
      asset_feed_spec: z
        .object({
          videos: z.array(z.unknown()).optional(),
          images: z.array(z.unknown()).optional(),
        })
        .passthrough()
        .optional(),
    })
    .optional(),
});
const Stats = z.array(z.object({ action_type: z.string(), value: ExactDecimal })).max(1000);
const Insight = z.object({
  ad_id: NumericId,
  account_id: NumericId,
  account_currency: z.string(),
  date_start: z.iso.date(),
  date_stop: z.iso.date(),
  impressions: ExactCount.optional(),
  inline_link_clicks: ExactCount.optional(),
  reach: ExactCount.optional(),
  spend: ExactDecimal.optional(),
  actions: Stats.optional(),
  action_values: Stats.optional(),
  purchase_roas: Stats.optional(),
});
const Page = z.object({ data: z.array(Insight).max(100), paging: z.unknown().optional() });
const valid = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const result = schema.safeParse(raw);
  if (!result.success) throw new FacebookReadError('invalid-source');
  return result.data;
};
function localDate(time: number, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(time);
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    midnight:
      part('hour') === '00' &&
      part('minute') === '00' &&
      part('second') === '00' &&
      time % 1000 === 0,
  };
}
/** Translate exclusive instants to inclusive Graph account-calendar dates; never use UTC slicing. */
export function facebookDateRange(raw: z.infer<typeof SourcePeriod>, now: number) {
  const period = valid(SourcePeriod, raw),
    from = Date.parse(period.from),
    to = Date.parse(period.toExclusive);
  const start = localDate(from, period.timezone),
    end = localDate(to, period.timezone);
  const calendarDays = (Date.parse(end.date) - Date.parse(start.date)) / 86400_000;
  if (!start.midnight || !end.midnight || calendarDays < 1 || calendarDays > 31 || from > now)
    throw new FacebookReadError('invalid-source');
  return { since: start.date, until: localDate(to - 1, period.timezone).date };
}
function action(rows: z.infer<typeof Stats> | undefined, type: string): string | null {
  const found = rows?.filter((r) => r.action_type === type) ?? [];
  if (found.length > 1) throw new FacebookReadError('invalid-source');
  return found[0]?.value ?? null;
}
export function createFacebookAdapter(
  connections: readonly Connection[],
  deps: FacebookReadDependencies,
): MarketingReadAdapter {
  const configured = new Map<string, Connection>();
  for (const raw of connections) {
    const c = valid(FacebookConnection, raw);
    if (configured.has(c.id)) throw new Error('Duplicate Facebook connection');
    configured.set(c.id, c);
  }
  const graph = createFacebookGraph(deps),
    now = deps.now ?? Date.now;
  const binding = (raw: z.infer<typeof SourceIdentityV2>) => {
    const identity = valid(SourceIdentityV2, raw),
      c = configured.get(identity.connectionId);
    if (
      !c ||
      identity.namespace !== c.namespace ||
      identity.accountId !== c.accountId ||
      !NumericId.safeParse(identity.externalId).success
    )
      throw new FacebookReadError('access');
    return { identity, c };
  };
  const account = async (c: Connection, signal: AbortSignal) => {
    const a = valid(
      Account,
      await graph(
        c.id,
        'act_' + c.accountId,
        { fields: 'id,account_id,currency,timezone_name' },
        signal,
      ),
    );
    if (
      a.id !== 'act_' + c.accountId ||
      a.account_id !== c.accountId ||
      a.currency !== c.currency ||
      a.timezone_name !== c.timezone
    )
      throw new FacebookReadError('invalid-source');
  };
  const ad = async (identity: z.infer<typeof SourceIdentityV2>, signal: AbortSignal) => {
    const a = valid(
      Ad,
      await graph(
        identity.connectionId,
        identity.externalId,
        { fields: 'id,account_id,name,effective_status,updated_time,creative{id,asset_feed_spec}' },
        signal,
      ),
    );
    if (a.id !== identity.externalId || a.account_id !== identity.accountId)
      throw new FacebookReadError('access');
    return a;
  };
  return {
    capability: 'facebook.ad_insights',
    supportsConnection: (id) => configured.has(id),
    async resolve(raw, signal, purpose = 'registration') {
      const { identity, c } = binding(raw);
      await account(c, signal);
      const a = await ad(identity, signal);
      if (
        a.effective_status === 'DELETED' ||
        (a.effective_status === 'ARCHIVED' && purpose !== 'history')
      )
        throw new FacebookReadError('not-found');
      const assets = a.creative?.asset_feed_spec;
      if ((assets?.videos?.length ?? 0) + (assets?.images?.length ?? 0) > 1)
        throw new FacebookReadError('invalid-source');
      return ResolvedSourceV2.parse({
        schemaVersion: 2,
        identity,
        apiVersion: FACEBOOK_VERSION,
        sourceRevision: a.updated_time ?? null,
        name: a.name,
        creativeIds: a.creative ? [a.creative.id] : null,
        fetchedAt: new Date(now()).toISOString(),
      });
    },
    async report(raw, rawPeriod, signal) {
      const { identity, c } = binding(raw),
        period = valid(SourcePeriod, rawPeriod);
      if (period.timezone !== c.timezone) throw new FacebookReadError('invalid-source');
      const range = facebookDateRange(period, now());
      await account(c, signal);
      const current = await ad(identity, signal);
      if (current.effective_status === 'DELETED') throw new FacebookReadError('not-found');
      const path = identity.externalId + '/insights';
      const params: Record<string, string> = {
        fields:
          'ad_id,account_id,account_currency,date_start,date_stop,impressions,inline_link_clicks,reach,spend,actions,action_values,purchase_roas',
        level: 'ad',
        time_range: JSON.stringify(range),
        time_increment: 'all_days',
        action_report_time: 'impression',
        action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
        use_account_attribution_setting: 'false',
        use_unified_attribution_setting: 'false',
        limit: '100',
      };
      const rows: z.infer<typeof Insight>[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      const base = () => ({
        schemaVersion: 2,
        identity,
        grain: 'ad-period',
        apiVersion: FACEBOOK_VERSION,
        reportDefinition: 'facebook.ad-period.v1',
        attribution: '7d_click+1d_view',
        actionReportTime: 'impression',
        period,
        fetchedAt: new Date(now()).toISOString(),
        dataThrough: null,
      });
      for (let page = 0; page < 20; page++) {
        const result = valid(
          Page,
          await graph(c.id, path, { ...params, ...(cursor ? { after: cursor } : {}) }, signal),
        );
        for (const row of result.data) {
          if (
            row.ad_id !== identity.externalId ||
            row.account_id !== c.accountId ||
            row.account_currency !== c.currency ||
            row.date_start !== range.since ||
            row.date_stop !== range.until
          )
            throw new FacebookReadError('invalid-source');
          rows.push(row);
          // all_days without breakdown is one row. Never add overlapping rows or daily reach.
          if (rows.length > 1) throw new FacebookReadError('invalid-source');
        }
        cursor = nextFacebookCursor(result.paging, path);
        if (!cursor) break;
        if (cursors.has(cursor)) throw new FacebookReadError('invalid-source');
        cursors.add(cursor);
      }
      if (cursor)
        return SourceReportV2.parse({
          ...base(),
          completeness: 'partial',
          coveredPeriod: null,
          nextCursor: cursor,
          reason: 'ยังอ่านรายงานจาก Facebook ไม่ครบทุกหน้า',
          metrics: [],
        });
      const row = rows[0];
      const specs = [
        ['impressions', row?.impressions ?? null, 'count', 'จำนวนครั้งที่แสดงโฆษณา'],
        [
          'link_clicks',
          row?.inline_link_clicks ?? null,
          'count',
          'การคลิกลิงก์ในโฆษณา (inline_link_clicks)',
        ],
        [
          'reach',
          row?.reach ?? null,
          'count',
          'การเข้าถึงตาม Meta สำหรับช่วงนี้ ห้ามบวกข้ามวันหรือแอด',
        ],
        ['spend', row?.spend ?? null, 'money', 'ค่าโฆษณาที่ Meta รายงาน ไม่ใช่คอมมิชชัน'],
        [
          'video_views',
          action(row?.actions, 'video_view'),
          'count',
          'การดูวิดีโอตามนิยาม Meta actions.video_view',
        ],
        [
          'platform_orders',
          action(row?.actions, 'omni_purchase'),
          'count',
          'การซื้อที่ Meta ระบุเป็น omni_purchase ไม่ใช่ออเดอร์ยืนยันจาก ERP',
        ],
        [
          'platform_value',
          action(row?.action_values, 'omni_purchase'),
          'money',
          'มูลค่า omni_purchase ที่ Meta ให้เครดิตแก่แอด ไม่ใช่รายได้พร้อมจ่าย',
        ],
        [
          'roas',
          action(row?.purchase_roas, 'omni_purchase'),
          'ratio',
          'ผลตอบแทนค่าโฆษณาตาม Meta purchase_roas ห้ามบวกข้ามช่วง',
        ],
      ] as const;
      const metrics = specs.map(([key, value, unit, definition]) =>
        valid(PlatformMetricV2, {
          schemaVersion: 2,
          key,
          value,
          unit,
          definition,
          currency: unit === 'money' ? c.currency : null,
          aggregation: ['reach', 'roas'].includes(key) ? 'non-additive' : 'sum-disjoint',
          unavailableReason: value === null ? 'Facebook ไม่ได้ส่งค่านี้ในรายงานที่อ่านได้' : null,
        }),
      );
      return SourceReportV2.parse({
        ...base(),
        completeness: 'complete',
        coveredPeriod: period,
        nextCursor: null,
        reason: null,
        metrics,
      });
    },
  };
}
