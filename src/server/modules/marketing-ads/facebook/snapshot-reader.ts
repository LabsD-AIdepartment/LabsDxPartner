import { z } from 'zod';
import { SourceIdentityV2 } from '@/contracts/platform-capabilities';
import {
  ExactCount,
  ExactDecimal,
  SourcePeriod,
  SourceReportV2,
  PlatformMetricV2,
} from '@/contracts/platform-metrics';
import { FacebookConnection } from './adapter';
import {
  createFacebookGraph,
  FacebookReadError,
  FACEBOOK_VERSION,
  nextFacebookCursor,
  type FacebookReadDependencies,
} from './graph';

// A SEPARATE bounded snapshot reader for the dev preview. Unlike the native adapter (whose window is
// capped at 31 days for the sync worker), this reader fetches ONE full-period aggregate of up to 93
// days so the requested Jul1..Aug31 range is a single report and every ratio (cpc/ctr/cpm/roas/cost
// per purchase) stays correct — monthly ratios are never averaged.
//
// It requests Meta's official derived fields plus spend and purchase economics, including the broad
// `actions`/`action_values` arrays needed to project the requested omni_purchase order count and
// purchase value. It also requests the owner-authorized `inline_link_clicks` count (emitted as the
// Celeb-safe `link_clicks`). It NEVER requests a still-prohibited audience-count field
// (impressions/reach/video_view). The broad action arrays are a transient source payload that may
// still carry unrelated Meta counts (e.g. video_view, and an actions `link_click` that is NOT the
// authoritative inline link-click field); those are discarded here and never emitted or persisted —
// only the single omni_purchase order count and purchase value are projected from the arrays. So the
// Celeb-safe counts link_clicks and platform_orders may enter the report, but no still-forbidden
// audience count ever does.

type Connection = z.infer<typeof FacebookConnection>;
const NumericId = z.string().regex(/^\d{1,80}$/);
const Account = z.object({
  id: z.string(),
  account_id: NumericId,
  currency: z.string(),
  timezone_name: z.string(),
});
const Creative = z.object({
  id: NumericId,
  video_id: NumericId.optional(),
  object_story_spec: z
    .object({ video_data: z.object({ video_id: NumericId }).partial().optional() })
    .partial()
    .optional(),
  asset_feed_spec: z
    .object({ videos: z.array(z.object({ video_id: NumericId }).partial()).max(200).optional() })
    .partial()
    .optional(),
});
const Ad = z.object({
  id: NumericId,
  account_id: NumericId,
  name: z.string().min(1).max(500),
  effective_status: z.string(),
  creative: Creative.optional(),
});
/** The creative/asset-video this ad is expected to resolve to, verified at refresh time. */
export type ExpectedCreative = { creativeId: string; videoId: string | null };
const Stats = z.array(z.object({ action_type: z.string(), value: ExactDecimal })).max(1000);
const Insight = z.object({
  ad_id: NumericId,
  account_id: NumericId,
  account_currency: z.string(),
  date_start: z.iso.date(),
  date_stop: z.iso.date(),
  // Meta-official derived economics, the owner-authorized inline link-click count, plus the broad
  // action arrays used SOLELY to project the single omni_purchase order count/value. No
  // still-forbidden audience-count field is requested; any unrelated count carried inside these
  // arrays is discarded, never emitted.
  spend: ExactDecimal.optional(),
  cpc: ExactDecimal.optional(),
  ctr: ExactDecimal.optional(),
  cpm: ExactDecimal.optional(),
  inline_link_clicks: ExactCount.optional(),
  purchase_roas: Stats.optional(),
  cost_per_action_type: Stats.optional(),
  actions: Stats.optional(),
  action_values: Stats.optional(),
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

/** Inclusive Graph calendar dates for a bounded snapshot window (1..93 days). Rejects UTC slicing. */
export function facebookSnapshotDateRange(raw: z.infer<typeof SourcePeriod>, now: number) {
  const period = valid(SourcePeriod, raw),
    from = Date.parse(period.from),
    to = Date.parse(period.toExclusive);
  const start = localDate(from, period.timezone),
    end = localDate(to, period.timezone);
  const calendarDays = (Date.parse(end.date) - Date.parse(start.date)) / 86400_000;
  // The window must be fully in the past: its exclusive end may not fall after the current completed
  // calendar boundary (today's local date). Otherwise it would include an in-progress day and could
  // be mis-presented as a complete full-period aggregate. `until` (= end - 1 day) is thus always a
  // completed day.
  const today = localDate(now, period.timezone).date;
  if (
    !start.midnight ||
    !end.midnight ||
    calendarDays < 1 ||
    calendarDays > 93 ||
    from > now ||
    end.date > today
  )
    throw new FacebookReadError('invalid-source');
  return { since: start.date, until: localDate(to - 1, period.timezone).date };
}

function action(rows: z.infer<typeof Stats> | undefined, type: string): string | null {
  const found = rows?.filter((r) => r.action_type === type) ?? [];
  if (found.length > 1) throw new FacebookReadError('invalid-source');
  return found[0]?.value ?? null;
}

/**
 * Create a bounded snapshot reader for one configured connection. `report` returns a single
 * full-period SourceReportV2 carrying only Celeb-safe economics (never audience counts).
 */
export function createFacebookSnapshotReader(rawConnection: Connection, deps: FacebookReadDependencies) {
  const c = valid(FacebookConnection, rawConnection);
  const graph = createFacebookGraph(deps),
    now = deps.now ?? Date.now;
  const account = async (signal: AbortSignal) => {
    const a = valid(
      Account,
      await graph(c.id, 'act_' + c.accountId, { fields: 'id,account_id,currency,timezone_name' }, signal),
    );
    if (
      a.id !== 'act_' + c.accountId ||
      a.account_id !== c.accountId ||
      a.currency !== c.currency ||
      a.timezone_name !== c.timezone
    )
      throw new FacebookReadError('invalid-source');
  };
  const ad = async (
    identity: z.infer<typeof SourceIdentityV2>,
    signal: AbortSignal,
    expected?: ExpectedCreative,
  ) => {
    const fields = expected
      ? 'id,account_id,name,effective_status,creative{id,video_id,object_story_spec,asset_feed_spec}'
      : 'id,account_id,name,effective_status';
    const a = valid(Ad, await graph(c.id, identity.externalId, { fields }, signal));
    if (a.id !== identity.externalId || a.account_id !== identity.accountId)
      throw new FacebookReadError('access');
    if (a.effective_status === 'DELETED') throw new FacebookReadError('not-found');
    if (expected) {
      const creative = a.creative;
      if (!creative || creative.id !== expected.creativeId)
        throw new FacebookReadError('invalid-source');
      if (expected.videoId !== null) {
        const videoIds = new Set<string>();
        if (creative.video_id) videoIds.add(creative.video_id);
        const storyVideo = creative.object_story_spec?.video_data?.video_id;
        if (storyVideo) videoIds.add(storyVideo);
        for (const v of creative.asset_feed_spec?.videos ?? [])
          if (v.video_id) videoIds.add(v.video_id);
        if (!videoIds.has(expected.videoId)) throw new FacebookReadError('invalid-source');
      }
    }
    return a;
  };
  return {
    connection: c,
    async report(
      rawIdentity: unknown,
      rawPeriod: unknown,
      signal: AbortSignal,
      expected?: ExpectedCreative,
    ) {
      const identity = valid(SourceIdentityV2, rawIdentity),
        period = valid(SourcePeriod, rawPeriod);
      if (
        identity.platform !== 'facebook' ||
        identity.connectionId !== c.id ||
        identity.namespace !== c.namespace ||
        identity.accountId !== c.accountId
      )
        throw new FacebookReadError('access');
      if (period.timezone !== c.timezone) throw new FacebookReadError('invalid-source');
      const range = facebookSnapshotDateRange(period, now());
      await account(signal);
      await ad(identity, signal, expected);
      const path = identity.externalId + '/insights';
      const params: Record<string, string> = {
        fields:
          'ad_id,account_id,account_currency,date_start,date_stop,spend,cpc,ctr,cpm,inline_link_clicks,purchase_roas,cost_per_action_type,actions,action_values',
        level: 'ad',
        time_range: JSON.stringify(range),
        time_increment: 'all_days',
        action_report_time: 'impression',
        action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
        use_account_attribution_setting: 'false',
        use_unified_attribution_setting: 'false',
        limit: '100',
      };
      const base = () => ({
        schemaVersion: 2,
        identity,
        grain: 'ad-period',
        apiVersion: FACEBOOK_VERSION,
        reportDefinition: 'facebook.ad-snapshot.v1',
        attribution: '7d_click+1d_view',
        actionReportTime: 'impression',
        period,
        fetchedAt: new Date(now()).toISOString(),
        dataThrough: null,
      });
      const rows: z.infer<typeof Insight>[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
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
      // No row at all means the source explicitly has no delivery for this window: unavailable,
      // never a fabricated zero.
      if (!row)
        return SourceReportV2.parse({
          ...base(),
          completeness: 'unavailable',
          coveredPeriod: null,
          nextCursor: null,
          reason: 'Facebook ไม่มีข้อมูลการยิงโฆษณาในช่วงที่ขอ',
          metrics: [],
        });
      // Definitions are plain-Thai MEANINGS shown straight to the Celeb UI. They intentionally carry
      // no raw Graph field names and no presentation/implementation instructions; the non-additive
      // nature is warned generically by the projector, not spelled out per metric here.
      const specs = [
        ['spend', row.spend ?? null, 'money', 'ค่าโฆษณาที่ Meta รายงาน ไม่ใช่คอมมิชชัน', 'sum-disjoint'],
        [
          'cpc',
          row.cpc ?? null,
          'money',
          'ต้นทุนเฉลี่ยต่อคลิกทั้งหมด',
          'non-additive',
        ],
        [
          'cpm',
          row.cpm ?? null,
          'money',
          'ต้นทุนเฉลี่ยต่อการแสดงโฆษณา 1,000 ครั้ง',
          'non-additive',
        ],
        [
          'ctr',
          row.ctr ?? null,
          'ratio',
          'สัดส่วนการคลิกทั้งหมดเทียบกับการแสดงโฆษณาตาม Meta',
          'non-additive',
        ],
        [
          'roas',
          action(row.purchase_roas, 'omni_purchase'),
          'ratio',
          'มูลค่าการซื้อที่ Meta ระบุต่อค่าโฆษณา 1 บาท',
          'non-additive',
        ],
        [
          'cost_per_purchase',
          action(row.cost_per_action_type, 'omni_purchase'),
          'money',
          'ต้นทุนโฆษณาเฉลี่ยต่อการซื้อที่ Meta ระบุ',
          'non-additive',
        ],
        // Owner-authorized link-click count, taken ONLY from Meta's dedicated inline_link_clicks
        // field (never from an actions `link_click` entry). Definition is the plain-Thai meaning.
        [
          'link_clicks',
          row.inline_link_clicks ?? null,
          'count',
          'คลิกลิงก์',
          'sum-disjoint',
        ],
        // Only the single omni_purchase entry is projected. `action` rejects a duplicated
        // omni_purchase and never sums overlapping purchase/offsite purchase types; any unrelated
        // count in the broad arrays (video_view/link_click) is simply not matched and discarded.
        [
          'platform_orders',
          action(row.actions, 'omni_purchase'),
          'count',
          'จำนวนการซื้อที่ Meta รายงาน',
          'sum-disjoint',
        ],
        [
          'platform_value',
          action(row.action_values, 'omni_purchase'),
          'money',
          'มูลค่าการซื้อที่ Meta รายงาน',
          'sum-disjoint',
        ],
      ] as const;
      const metrics = specs.map(([key, value, unit, definition, aggregation]) =>
        valid(PlatformMetricV2, {
          schemaVersion: 2,
          key,
          value,
          unit,
          definition,
          currency: unit === 'money' ? c.currency : null,
          aggregation,
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
