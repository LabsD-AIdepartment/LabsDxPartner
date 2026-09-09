import postgres from 'postgres';
import { resolve, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');

/** This runner is deliberately restricted to a project-owned disposable local cluster. */
export async function connectTestDatabase() {
  let url;
  try {
    url = new URL(process.env.LABSD_TEST_DATABASE_URL ?? '');
  } catch {
    throw new Error('Set the isolated LABSD_TEST_DATABASE_URL');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55487' ||
    url.pathname !== '/labsd_partner_test'
  ) {
    throw new Error('Refusing non-isolated database target');
  }
  const sql = postgres(url.toString(), {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
  try {
    const [row] =
      await sql`select current_database() as database, current_setting('data_directory') as directory`;
    if (
      row.database !== 'labsd_partner_test' ||
      !resolve(row.directory).startsWith(resolve(root, '.agent-work') + sep)
    )
      throw new Error('Refusing database outside the project-owned cluster');
    return sql;
  } catch (error) {
    await sql.end();
    throw error;
  }
}
