/** Server-owned deployment control. It never grants staff or financial authority. */
export function statementPublicationEnabled(env: Record<string, string | undefined>): boolean {
  return env.LABSD_IDENTITY_ENABLED === '1' &&
    env.LABSD_FINANCE_ENABLED === '1' &&
    env.LABSD_STATEMENT_PUBLICATION_ENABLED === '1';
}
