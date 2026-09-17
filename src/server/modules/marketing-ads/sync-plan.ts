import { z } from 'zod';
import type { Sql } from 'postgres';
import { SourcePeriod } from '@/contracts/platform-metrics';
import type { FacebookProfile } from './facebook/config';
import { createMarketingSyncStore } from './sync-store';
import { FACEBOOK_VERSION } from './facebook/graph';
const formatter = (zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
function parts(format: Intl.DateTimeFormat, instant: number) {
  const p = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}
/** Explicit civil-day conversion; rejects timezones/dates without a representable midnight. */
function midnight(format: Intl.DateTimeFormat, date: string) {
  const wanted = Date.parse(date + 'T00:00:00Z');
  let instant = wanted;
  for (let i = 0; i < 6; i++) {
    const p = parts(format, instant),
      wall = Date.parse(p.date + 'T00:00:00Z') + (p.hour * 3600 + p.minute * 60 + p.second) * 1000;
    if (wall === wanted) return new Date(instant).toISOString();
    instant += wanted - wall;
  }
  throw new Error('Reporting calendar midnight is unavailable');
}
export function dailyReportWindows(timezone: string, now: number, days = 90) {
  z.number().finite().parse(now);
  z.number().int().min(1).max(366).parse(days);
  const fmt = formatter(timezone),
    today = parts(fmt, now).date,
    base = Date.parse(today + 'T00:00:00Z');
  const date = (offset: number) => new Date(base + offset * 86400_000).toISOString().slice(0, 10);
  return Array.from({ length: days }, (_, age) => ({
    age,
    period: SourcePeriod.parse({
      from: midnight(fmt, date(-age)),
      toExclusive: midnight(fmt, date(1 - age)),
      timezone,
    }),
    refreshSeconds: age < 7 ? 900 : 86400,
  }));
}
export const facebookDailyDefinition = {
  apiVersion: FACEBOOK_VERSION,
  reportDefinition: 'facebook.ad-period.v1',
  attribution: '7d_click+1d_view',
  actionReportTime: 'impression',
};
/** One eligible association per invocation; repeated/concurrent planning is idempotent. */
export async function planNextMarketingJob(
  sql: Sql,
  profiles: readonly FacebookProfile[],
  now = Date.now(),
  days = 90,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!profiles.length) return { planned: 0 };
  const [job] = await sql`select j.id,a.connection_id from portal_marketing.sync_jobs j
    join portal_marketing.associations a on a.id=j.association_id
    join portal_marketing.connections c on c.id=a.connection_id
    join portal_marketing.targets t on t.id=a.target_id
    join portal_access.partners p on p.id=a.partner_id
    join portal_content.clips cl on cl.partner_id=a.partner_id and cl.id=a.clip_id
    where a.connection_id in ${sql(profiles.map((p) => p.id))} and c.enabled and c.verified_at is not null and t.active and p.status='active' and not cl.removed
      and (j.last_planned_at is null or j.last_planned_at<clock_timestamp()-interval '15 minutes')
    order by j.last_planned_at nulls first,j.id limit 1`;
  if (!job) return { planned: 0 };
  const profile = profiles.find((p) => p.id === job.connection_id)!;
  const store = createMarketingSyncStore(sql),
    windows = dailyReportWindows(profile.timezone, now, days);
  const planned = await store.plan(
    job.id,
    windows.map(({ period, refreshSeconds }) => ({ period, refreshSeconds })),
    facebookDailyDefinition,
    now,
    signal,
  );
  return { planned };
}
