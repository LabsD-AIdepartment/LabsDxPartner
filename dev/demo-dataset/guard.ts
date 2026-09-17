// Development-only server guards for the coherent partner-demo dataset. Imported ONLY by the dev
// SQLite read path (db.ts consumers / the dev GET handler / the seed CLIs) — NEVER by app/ code and
// NEVER by the browser projections. `assertDevelopment` throws outside development so an accidental
// production import fails closed, in addition to the route's own NODE_ENV guard + the production
// alias that swaps the whole handler for a 404 stub.

import { resolve, sep } from 'node:path';

/** True only when the process runs in Next's development mode. */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/** Fail closed: throw unless running in development. */
export function assertDevelopment(context = 'demo-dataset'): void {
  if (!isDevelopment())
    throw new Error(`${context}: the demo dataset is development-only and must never run in production`);
}

// The project-local, reversible database path. Kept under the task workarea so root can delete the
// whole directory to fully remove the sample. Overridable via DEMO_DATASET_DB, but the resolved
// override MUST stay inside the project directory (policy + the CLI --path guard) — an override that
// escapes process.cwd() is rejected. Tests inject a path directly through HandlerDeps instead.
const DEFAULT_DB_RELATIVE = '.agent-work/20260917-coherent-demo-data/database/demo-dataset.sqlite';

export function defaultDatabasePath(): string {
  const override = process.env.DEMO_DATASET_DB;
  if (override && override.length > 0) {
    const cwd = process.cwd();
    const resolved = resolve(cwd, override);
    if (resolved !== cwd && !resolved.startsWith(cwd + sep))
      throw new Error(
        `demo-dataset: DEMO_DATASET_DB must resolve inside the project directory: ${resolved}`,
      );
    return resolved;
  }
  return resolve(process.cwd(), DEFAULT_DB_RELATIVE);
}
