import { connectTestDatabase } from './test-database.mjs';
import { celebrityPeriod } from '../dev/financial/celebrity-period';
import { createImportRunner } from '../src/server/modules/imports/run';

/** Explicit developer trial only; normal import-once never selects this mode implicitly. */
export async function importSynthetic() {
  const sql = await connectTestDatabase();
  try {
    const sample = celebrityPeriod('synthetic-celebrity-001');
    await sql`insert into portal_access.partners(id,name,status) values(${sample.file.partnerId},'คุณ · ดาราตัวอย่าง','active') on conflict(id) do nothing`;
    const run = createImportRunner(sql, {
      load: async (id) => {
        if (id !== 'synthetic-finance-review-1') throw new Error('Unknown synthetic approval');
        return { sequence: '1', context: sample.context };
      },
    });
    const result = await run(sample.raw, 'synthetic-finance-review-1', 'synthetic-first-period-v1');
    const [totals] =
      await sql`select g.included_count,g.excluded_count,g.eligible_base_minor::text,g.amount_minor::text,g.data_through from portal_imports.generations g join portal_imports.scopes s on s.current_generation=g.id where s.partner_id=${sample.file.partnerId}`;
    console.log(
      JSON.stringify({
        mode: 'synthetic',
        publication: 'internal-candidate-only',
        ...result,
        totals,
      }),
    );
  } finally {
    await sql.end();
  }
}
