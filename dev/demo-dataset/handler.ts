// Development-only dev GET handler for the coherent partner-demo dataset. Server-only: it touches
// node:sqlite (via db.ts) + node:fs (via guard.ts). It is selected by the `@demo-dataset-handler`
// build alias ONLY in the development server; production resolves the alias to
// `handler.unavailable.ts` (a 404 stub) so none of this code, nor the fixture marker, ships.
//
// Contract (see .agent-work/.../integration-api.md §1):
//   GET /api/dev/demo-dataset?identity=a|b
//     → 200 application/json  DatasetRecords   (validated, JSON-serialisable, money = decimal strings)
//     → 404                                    (unknown identity, missing seed/database, non-dev)
//     → 503                                    (corrupt stored data or an unexpected read failure)
//
// The identity is a strict allowlist; the generation is SERVER-OWNED (DEFAULT_GENERATION), never a
// query parameter. The database is opened READ-ONLY and is never created or migrated on a read.

import { DEFAULT_GENERATION, DEMO_DATASET_MARKER, validateDataset } from './dataset';
import { MissingDatabaseError, openExistingDatabaseReadOnly, readDataset, type Db } from './db';
import { assertDevelopment, defaultDatabasePath } from './guard';
import { assertIdentityMatchesDataset, datasetIdForIdentity } from './scope';

export interface HandlerDeps {
  /** Override the read-only database path (tests / an explicitly project-local override). */
  databasePath?: string;
  /** Override the server-owned generation (defaults to DEFAULT_GENERATION; root chooses g1 today). */
  generation?: string;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  // Marker header keeps DEMO_DATASET_MARKER referenced at runtime so a leak of this dev-only module
  // into a production bundle is detectable by scripts/verify-no-demo.mjs.
  'x-demo-dataset': DEMO_DATASET_MARKER,
} as const;

function notFound(reason: string): Response {
  return new Response(JSON.stringify({ error: 'not_found', reason }), {
    status: 404,
    headers: JSON_HEADERS,
  });
}
function unavailable(reason: string): Response {
  return new Response(JSON.stringify({ error: 'unavailable', reason }), {
    status: 503,
    headers: JSON_HEADERS,
  });
}

/**
 * Resolve a validated DatasetRecords for the requested identity, or an error Response. Pure over its
 * `deps`, so tests can inject a project-local database path and a generation.
 */
export async function handleDemoDatasetRequest(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  // Defence in depth: even behind the route's NODE_ENV guard + the production alias, fail closed.
  try {
    assertDevelopment('demo-dataset handler');
  } catch {
    return notFound('development-only');
  }

  const identity = new URL(request.url).searchParams.get('identity') ?? '';
  let datasetId: string;
  try {
    datasetId = datasetIdForIdentity(identity);
  } catch {
    return notFound('unknown identity');
  }

  const generation = deps.generation ?? DEFAULT_GENERATION;
  const path = deps.databasePath ?? defaultDatabasePath();

  let db: Db;
  try {
    db = openExistingDatabaseReadOnly(path);
  } catch (error) {
    if (error instanceof MissingDatabaseError) return notFound('no seeded database');
    return unavailable('database open failed');
  }

  try {
    const raw = readDataset(db, datasetId, generation);
    if (raw === null) return notFound('dataset not seeded');
    // Strict validation BEFORE serialising: corrupt money/rates/scope/dates/refs/sums never display.
    const validated = validateDataset(raw);
    assertIdentityMatchesDataset(validated, identity);
    // Audience view counts are never presented publicly (parity with the real server read-models). The
    // stored DB rows / `readDataset` output keep their real integers; only this serialized COPY masks
    // every clip's `views` to null. Financial fields and every other row are passed through untouched.
    const publicView = {
      ...validated,
      clips: validated.clips.map((clip) => ({ ...clip, views: null })),
    };
    return new Response(JSON.stringify(publicView), { status: 200, headers: JSON_HEADERS });
  } catch {
    return unavailable('stored dataset failed validation');
  } finally {
    db.close();
  }
}
