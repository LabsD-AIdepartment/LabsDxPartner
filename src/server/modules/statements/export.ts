import { z } from 'zod';
import { Id } from '@/contracts/common';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
import { earningLineRef } from '@/server/modules/earnings/corrections';
import { IntakeRow } from '@/server/adapters/approved-period/schema';
const Export = z.strictObject({ partnerId: Id, statementId: z.uuid(), version: z.uuid() });
export const STATEMENT_EXPORT_LIMIT = 10_000;
/** Quote text and neutralize spreadsheet formula prefixes, including whitespace-prefixed formulas. */
export const csvText = (value: string) =>
  '"' + (/^(?:\s*[=+@-]|[\t\r\n])/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
const decimal = (minor: string) => {
  const amount = BigInt(minor),
    abs = amount < 0n ? -amount : amount;
  return (amount < 0n ? '-' : '') + String(abs / 100n) + '.' + String(abs % 100n).padStart(2, '0');
};
export class StatementExportTooLarge extends Error {}
/** Authorize and read the exact immutable version before streaming a bounded CSV response. */
export function createStatementExport(access: ReturnType<typeof createPartnerAccess>) {
  return async (headers: Headers, input: unknown) => {
    const command = Export.parse(input);
    return access.withPartner(headers, command.partnerId, 'view_statements', async (tx) => {
      const [statement] =
        await tx`select s.*,g.included_count,g.excluded_count from portal_statements.statements s
        join portal_imports.generations g on g.id=s.generation_id
        where s.partner_id=${command.partnerId} and s.id=${command.statementId}`;
      if (!statement) throw new AccessFailure('forbidden');
      if (statement.generation_id !== command.version) throw new AccessFailure('conflict');
      if (statement.included_count + statement.excluded_count > STATEMENT_EXPORT_LIMIT)
        throw new StatementExportTooLarge();
      const rows =
        await tx`select payload from portal_imports.earning_rows where generation_id=${statement.generation_id}
        order by earned_at,entitlement_key limit ${STATEMENT_EXPORT_LIMIT + 1}`;
      if (rows.length > STATEMENT_EXPORT_LIMIT) throw new StatementExportTooLarge();
      if (rows.length !== statement.included_count + statement.excluded_count)
        throw new AccessFailure('conflict');
      const lines = [
        'statement_id,version,period_from,period_to_exclusive,new_earnings_thb,adjustments_thb,excluded_count\r\n',
        [
          command.statementId,
          command.version,
          new Date(statement.period_from).toISOString(),
          new Date(statement.period_to).toISOString(),
        ]
          .map(csvText)
          .join(',') +
          ',' +
          decimal(String(statement.new_earnings_minor)) +
          ',' +
          decimal(String(statement.adjustments_minor)) +
          ',' +
          String(statement.excluded_count) +
          '\r\n',
        '\r\nline_id,earned_at,disposition,kind,content_id,agreement_version,eligible_sales_thb,rate_ppm,amount_thb,source_revision,original_line_id,reason_ref,evidence_ref\r\n',
      ];
      for (const { payload } of rows) {
        const row = IntakeRow.parse(payload);
        if (row.disposition === 'unresolved') throw new AccessFailure('conflict');
        const earning = row.disposition === 'included' ? row.earning : null;
        lines.push(
          [
            csvText(earningLineRef(command.version, row.entitlement)),
            csvText(row.earnedAt),
            csvText(row.disposition),
            csvText(earning?.kind ?? ''),
            csvText(
              row.disposition === 'included' && row.attribution.kind === 'content'
                ? row.attribution.contentId
                : '',
            ),
            csvText(row.disposition === 'included' ? row.agreementVersion : ''),
            earning?.kind === 'commission' ? decimal(earning.baseMinor) : '',
            earning?.kind === 'commission' ? String(earning.ratePpm) : '',
            earning ? decimal(earning.amountMinor) : '',
            csvText(row.sourceRevision),
            csvText(earning?.kind === 'adjustment' ? earning.originalLineRef : ''),
            csvText(
              row.disposition === 'excluded'
                ? row.reasonRef
                : earning?.kind === 'adjustment'
                  ? earning.reasonRef
                  : '',
            ),
            csvText(row.evidenceRef),
          ].join(',') + '\r\n',
        );
      }
      return { filename: 'statement-' + command.statementId + '.csv', lines };
    });
  };
}
