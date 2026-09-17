import type { Sql } from 'postgres';
import { setTimeout as delay } from 'node:timers/promises';
import { SourceReadError } from '../source-error';
import type { FacebookReadDependencies } from './graph';
import type { FacebookProfile } from './config';

/** Shared by staff lookup and acquisition workers. All Facebook apps share a conservative app bucket. */
export function createFacebookQuota(
  sql: Sql,
  profiles: readonly FacebookProfile[],
  assertBinding: () => Promise<void>,
  metadataVerification = false,
) {
  const configured = new Map(profiles.map((p) => [p.id, p]));
  const buckets = (id: string) => ['facebook:app', 'facebook:connection:' + id];
  return {
    async beforeRequest(id, signal) {
      const profile = configured.get(id);
      if (!profile) throw new SourceReadError('access');
      while (true) {
        signal.throwIfAborted();
        await assertBinding();
        const result = await sql.begin(async (tx) => {
          await tx`set local lock_timeout='2s'`;
          await tx`set local statement_timeout='3s'`;
          const [connection] = await tx`select id from portal_marketing.connections
            where id=${id} and namespace=${profile.namespace} and account_id=${profile.accountId}
              and (${metadataVerification} or (enabled and verified_at is not null)) and capability='facebook.ad_insights' for share`;
          if (!connection) throw new SourceReadError('access');
          const keys = buckets(id);
          for (const key of keys)
            await tx`insert into portal_marketing.request_limits(bucket) values(${key}) on conflict do nothing`;
          const rows = await tx`select bucket,
            greatest(0,extract(epoch from (blocked_until-clock_timestamp()))*1000)::float as blocked,
            greatest(0,extract(epoch from (next_at-clock_timestamp()))*1000)::float as wait
            from portal_marketing.request_limits where bucket in ${tx(keys)} order by bucket for update`;
          const blocked = Math.max(...rows.map((r) => Number(r.blocked))),
            wait = Math.max(...rows.map((r) => Number(r.wait)));
          if (blocked > 0) return { blocked, wait: 0 };
          if (wait > 0) return { blocked: 0, wait };
          signal.throwIfAborted();
          await tx`update portal_marketing.request_limits set next_at=clock_timestamp()+
            case when bucket='facebook:app' then interval '200 milliseconds' else interval '500 milliseconds' end
            where bucket in ${tx(keys)}`;
          return { blocked: 0, wait: 0 };
        });
        if (result.blocked > 0) throw new SourceReadError('throttled', Math.ceil(result.blocked));
        if (!result.wait) {
          signal.throwIfAborted();
          return;
        }
        await delay(Math.min(1000, Math.ceil(result.wait)), undefined, { signal });
      }
    },
    async recordUsage(id, usage) {
      if (!configured.has(id)) throw new SourceReadError('access');
      if (usage.percent < 80 && usage.retryAfterMs <= 0) return;
      const ms = Math.max(60_000, Math.min(7 * 86400_000, usage.retryAfterMs));
      const keys = (usage.appPercent ?? 0) >= 80 ? buckets(id) : [buckets(id)[1]];
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout='2s'`;
        await tx`set local statement_timeout='3s'`;
        for (const key of keys)
          await tx`insert into portal_marketing.request_limits(bucket,blocked_until)
          values(${key},clock_timestamp()+${ms}*interval '1 millisecond')
          on conflict(bucket) do update set blocked_until=greatest(portal_marketing.request_limits.blocked_until,excluded.blocked_until)`;
      });
    },
  } satisfies Required<Pick<FacebookReadDependencies, 'beforeRequest' | 'recordUsage'>>;
}
