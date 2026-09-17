import type { connectTestDatabase } from '../../scripts/test-database.mjs';

/** Each isolated legacy identity suite must establish its own fixture; test order
 * must not depend on access-control.test.ts having run first. Never replace an
 * existing namespace or weaken the real runtime binding check. */
export async function ensureTestIdentityBinding(
  sql: Awaited<ReturnType<typeof connectTestDatabase>>,
  digest: string,
) {
  await sql`insert into portal_identity.binding(id,namespace_digest) values('current',${digest}) on conflict(id) do nothing`;
  const [binding] =
    await sql`select namespace_digest from portal_identity.binding where id='current'`;
  if (binding?.namespace_digest !== digest) throw new Error('Test namespace is not bound');
}
