// Development-only CLI: seed BOTH partner-demo identities (a + b) into the project-local SQLite
// dataset database, idempotently. Root runs this — no command is executed by the author.
//
// Usage (the seed modules are TypeScript, so load the tsx loader):
//   NODE_ENV=development node --import tsx scripts/demo-dataset-seed.mjs
//   NODE_ENV=development node --import tsx scripts/demo-dataset-seed.mjs --generation g2
//   NODE_ENV=development node --import tsx scripts/demo-dataset-seed.mjs --as-of 2026-09-17T09:00:00+07:00
//   NODE_ENV=development node --import tsx scripts/demo-dataset-seed.mjs --path .agent-work/.../custom.sqlite
//
// Flags:
//   --generation <id>       server-owned generation to write (default: DEFAULT_GENERATION = g2)
//   --as-of <iso>           seed clock (default: now); its Bangkok date anchors the latest-7 window
//   --path <file>           override DB path (MUST stay inside this project directory)
//   --allow-out-of-period   author a seed clock outside the narrated September open period (unsafe)
//
// Immutability: re-running for the SAME generation + SAME anchor day is a no-op ('unchanged'); a new
// anchor day requires a NEW --generation (the CLI surfaces DatasetImmutabilityError and exits 1).

import { mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { seedDataset } from '../dev/demo-dataset/seed.ts';
import { DATASET_IDS, DEFAULT_GENERATION } from '../dev/demo-dataset/dataset.ts';
import { assertDevelopment, defaultDatabasePath } from '../dev/demo-dataset/guard.ts';

function parseArgs(argv) {
  const args = { generation: DEFAULT_GENERATION, allowOutOfPeriod: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--generation') args.generation = argv[++i];
    else if (flag === '--as-of') args.asOf = argv[++i];
    else if (flag === '--path') args.path = argv[++i];
    else if (flag === '--allow-out-of-period') args.allowOutOfPeriod = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

/** Resolve the DB path and refuse anything outside this project directory. */
function resolveProjectLocalPath(override) {
  if (!override) return defaultDatabasePath();
  const resolved = resolve(process.cwd(), override);
  if (resolved !== process.cwd() && !resolved.startsWith(process.cwd() + sep))
    throw new Error(`--path must stay inside the project directory: ${resolved}`);
  return resolved;
}

function main() {
  assertDevelopment('demo-dataset seed CLI');
  const args = parseArgs(process.argv.slice(2));
  const path = resolveProjectLocalPath(args.path);
  const asOf = args.asOf ? new Date(args.asOf) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error(`--as-of is not a valid date: ${args.asOf}`);

  mkdirSync(dirname(path), { recursive: true });

  const summary = { path, generation: args.generation, asOf: asOf.toISOString(), datasets: [] };
  for (const identity of Object.keys(DATASET_IDS)) {
    const result = seedDataset({
      path,
      datasetId: DATASET_IDS[identity],
      generation: args.generation,
      asOf,
      allowOutOfPeriod: args.allowOutOfPeriod,
    });
    summary.datasets.push({
      identity,
      datasetId: result.datasetId,
      generation: result.generation,
      anchorDate: result.anchorDate,
      asOf: result.asOf,
      outcome: result.outcome,
      counts: result.counts,
    });
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`demo-dataset seed failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
