import { createHash } from 'node:crypto';

export const instantSqlFormat = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/** $1 partner, $2 from, $3 exclusive end. Only issued statement generations are public. */
export const publishedPeriodsSql = `pubs as materialized (
  select s.generation_id,s.period_from,s.period_to,g.data_through
  from portal_statements.statements s join portal_imports.generations g on g.id=s.generation_id and g.scope_id=s.scope_id
  where s.partner_id=$1 and s.period_from<$3::timestamptz and s.period_to>$2::timestamptz
  order by s.period_from,s.id limit 1001
)`;

/** Search, page and resource do not change the financial snapshot. Settlements are independent. */
export function earningsGeneration(
  partnerId: string,
  from: string,
  to: string,
  brand: string | null,
  statementsRevision: string,
  catalogueRevision: string,
) {
  return createHash('sha256')
    .update(JSON.stringify([partnerId, from, to, brand, statementsRevision, catalogueRevision]))
    .digest('hex');
}
