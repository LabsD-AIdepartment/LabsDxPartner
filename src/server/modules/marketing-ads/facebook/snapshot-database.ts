import { createHash, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import { AdPerformanceSnapshot } from '@/contracts/ad-performance-snapshot';
import { projectAdSnapshot } from './snapshot-projection';
import { AdSnapshotBindingConfig, type AdSnapshotBindingConfigValue } from './snapshot-config';

export const SNAPSHOT_REFRESH_MS = 60 * 60_000;
export class SnapshotAdmissionLimit extends Error {}
export function snapshotBindingKey(binding: AdSnapshotBindingConfigValue) {
  // Explicit fixed-order identity; dates and display permission are not source identity.
  return createHash('sha256')
    .update(
      JSON.stringify([
        binding.identity,
        binding.clipId,
        binding.profileId,
        binding.namespace,
        binding.accountId,
        binding.adId,
        binding.expectedCreativeId,
        binding.expectedVideoId,
        binding.currency,
        binding.timezone,
      ]),
    )
    .digest('hex');
}
export type SnapshotLease = {
  bindingKey: string;
  from: string;
  toExclusive: string;
  token: string;
};
export type StoredAdSnapshot = { raw: unknown; stale: boolean };

/** Provider observations only. Neither this store nor its worker writes accounting records. */
export function createSnapshotDatabase(sql: Sql, namespace: string) {
  if (!/^[a-f0-9]{64}$/.test(namespace)) throw new Error('Invalid namespace');
  const key = (b: AdSnapshotBindingConfigValue) =>
    snapshotBindingKey(AdSnapshotBindingConfig.parse(b));
  const validate = (b: AdSnapshotBindingConfigValue, raw: unknown) => {
    const snapshot = AdPerformanceSnapshot.parse(raw);
    projectAdSnapshot(
      snapshot,
      { identity: b.identity, clipId: b.clipId, from: b.from, toExclusive: b.toExclusive },
      b,
    );
    if (snapshot.report.completeness !== 'complete') throw new Error('Incomplete observation');
    return snapshot;
  };
  return {
    /** Bounded, idempotent demand registration. A page never performs source I/O. */
    async request(b: AdSnapshotBindingConfigValue) {
      const bindingKey = key(b);
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout='2s'`;
        await tx`set local statement_timeout='3s'`;
        await tx`select pg_advisory_xact_lock(hashtextextended(${namespace + bindingKey},0))`;
        const [existing] =
          await tx`select requested_at>clock_timestamp()-interval '7 days' as active from portal_marketing.external_ad_snapshots
          where namespace_digest=${namespace} and binding_key=${bindingKey} and period_from=${b.from}::date and period_to=${b.toExclusive}::date`;
        if (!existing?.active) {
          const [count] =
            await tx`select count(*)::int as n from portal_marketing.external_ad_snapshots
            where namespace_digest=${namespace} and binding_key=${bindingKey} and requested_at>clock_timestamp()-interval '7 days'`;
          if (count.n >= 128) throw new SnapshotAdmissionLimit('Report window limit reached');
        }
        await tx`insert into portal_marketing.external_ad_snapshots(namespace_digest,binding_key,period_from,period_to)
          values(${namespace},${bindingKey},${b.from}::date,${b.toExclusive}::date)
          on conflict(namespace_digest,binding_key,period_from,period_to) do update set requested_at=clock_timestamp()`;
      });
    },
    async read(b: AdSnapshotBindingConfigValue): Promise<StoredAdSnapshot | null> {
      const [row] =
        await sql`select snapshot,issue, fetched_at < clock_timestamp()-interval '2 hours' as expired
        from portal_marketing.external_ad_snapshots where namespace_digest=${namespace} and binding_key=${key(b)}
        and period_from=${b.from}::date and period_to=${b.toExclusive}::date`;
      if (!row?.snapshot) return null;
      return { raw: validate(b, row.snapshot), stale: row.expired || row.issue !== null };
    },
    async seed(b: AdSnapshotBindingConfigValue, raw: unknown) {
      const snapshot = validate(b, raw);
      await sql`insert into portal_marketing.external_ad_snapshots(namespace_digest,binding_key,period_from,period_to,snapshot,fetched_at)
        values(${namespace},${key(b)},${b.from}::date,${b.toExclusive}::date,${sql.json(snapshot)},${snapshot.report.fetchedAt}::timestamptz)
        on conflict(namespace_digest,binding_key,period_from,period_to) do update set snapshot=excluded.snapshot,fetched_at=excluded.fetched_at
        where external_ad_snapshots.snapshot is null or external_ad_snapshots.fetched_at<excluded.fetched_at`;
    },
    async claim(bindings: readonly AdSnapshotBindingConfigValue[]): Promise<SnapshotLease | null> {
      if (!bindings.length) return null;
      const keys = bindings.map(key),
        token = randomUUID();
      const [row] = await sql`with candidate as (
        select namespace_digest,binding_key,period_from,period_to from portal_marketing.external_ad_snapshots
        where namespace_digest=${namespace} and binding_key in ${sql(keys)}
          and requested_at>clock_timestamp()-interval '7 days' and next_run_at<=clock_timestamp()
          and (lease_until is null or lease_until<=clock_timestamp())
        order by (snapshot is null) desc, next_run_at,period_to desc for update skip locked limit 1
      ) update portal_marketing.external_ad_snapshots s set lease_token=${token},lease_until=clock_timestamp()+interval '2 minutes',last_attempt_at=clock_timestamp()
        from candidate c where s.namespace_digest=c.namespace_digest and s.binding_key=c.binding_key and s.period_from=c.period_from and s.period_to=c.period_to
        returning s.binding_key,to_char(s.period_from,'YYYY-MM-DD') as from_date,to_char(s.period_to,'YYYY-MM-DD') as to_date`;
      return row
        ? { bindingKey: row.binding_key, from: row.from_date, toExclusive: row.to_date, token }
        : null;
    },
    async publish(lease: SnapshotLease, b: AdSnapshotBindingConfigValue, raw: unknown) {
      if (
        key(b) !== lease.bindingKey ||
        b.from !== lease.from ||
        b.toExclusive !== lease.toExclusive
      )
        throw new Error('Lease scope mismatch');
      const snapshot = validate(b, raw);
      const rows =
        await sql`update portal_marketing.external_ad_snapshots set snapshot=${sql.json(snapshot)},fetched_at=${snapshot.report.fetchedAt}::timestamptz,
        next_run_at=clock_timestamp()+interval '1 hour',lease_token=null,lease_until=null,issue=null
        where namespace_digest=${namespace} and binding_key=${lease.bindingKey} and period_from=${lease.from}::date and period_to=${lease.toExclusive}::date
          and lease_token=${lease.token} and lease_until>clock_timestamp()
          and (fetched_at is null or fetched_at<=${snapshot.report.fetchedAt}::timestamptz) returning binding_key`;
      return rows.length === 1;
    },
    async fail(lease: SnapshotLease) {
      await sql`update portal_marketing.external_ad_snapshots set issue='unavailable',next_run_at=clock_timestamp()+interval '1 hour',lease_token=null,lease_until=null
        where namespace_digest=${namespace} and binding_key=${lease.bindingKey} and period_from=${lease.from}::date and period_to=${lease.toExclusive}::date and lease_token=${lease.token}`;
    },
  };
}
