// Development-only, READ-ONLY snapshot file reader for the ad-performance preview. Server-only: it
// touches node:fs and is imported ONLY by the dev handler / the operator refresh writer, never by the
// browser and never by app/ code. It serves persisted snapshot files ONLY — there is no arbitrary
// path, Graph proxy, adId, accountId, URL or credential accepted from a caller here.

import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export class MissingSnapshotError extends Error {}

const SAFE_NAME = /^[a-z0-9][a-z0-9-]*__[A-Za-z0-9_-]+\.json$/;

function safePath(dir: string, fileName: string): string {
  if (!SAFE_NAME.test(fileName)) throw new Error(`ad-snapshot: unsafe snapshot file name ${fileName}`);
  const path = resolve(dir, fileName);
  if (path !== resolve(dir, fileName) || !path.startsWith(resolve(dir) + sep))
    throw new Error('ad-snapshot: snapshot path escapes its directory');
  return path;
}

/** Parse a persisted snapshot file as unknown JSON (validation happens in the projection layer). */
export function readSnapshotFile(dir: string, fileName: string): unknown {
  const path = safePath(dir, fileName);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MissingSnapshotError(fileName);
    throw error;
  }
  if (raw.length > 256_000) throw new Error('ad-snapshot: snapshot file too large');
  return JSON.parse(raw) as unknown;
}

/** Atomic writer used by the operator refresh path. Creates the project-local directory if needed. */
export function writeSnapshotFile(dir: string, fileName: string, contents: string): void {
  const path = safePath(dir, fileName);
  mkdirSync(dir, { recursive: true });
  const tmp = path + '.tmp';
  writeFileSync(tmp, contents, { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, path);
}
