// Development-only CLI: remove ONLY the named partner-demo dataset generation(s) from the
// project-local SQLite database, leaving every other dataset/generation intact. Root runs this.
//
// Usage (TypeScript modules → load the tsx loader):
//   NODE_ENV=development node --import tsx scripts/demo-dataset-remove.mjs                 # both a + b, g2
//   NODE_ENV=development node --import tsx scripts/demo-dataset-remove.mjs --generation g1 # both a + b, g1
//   NODE_ENV=development node --import tsx scripts/demo-dataset-remove.mjs --dataset partner-demo-a
//   NODE_ENV=development node --import tsx scripts/demo-dataset-remove.mjs --path .agent-work/.../custom.sqlite
//
// Flags:
//   --generation <id>  generation to remove (default: DEFAULT_GENERATION = g2)
//   --dataset <id>     remove only this dataset id (default: both allowlisted a + b)
//   --path <file>      override DB path (MUST stay inside this project directory)
//
// Removal is scoped by the compound (dataset_id, generation) key; a missing database is a no-op.

import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { removeDataset } from '../dev/demo-dataset/seed.ts';
import { DATASET_IDS, DEFAULT_GENERATION } from '../dev/demo-dataset/dataset.ts';
import { assertDevelopment, defaultDatabasePath } from '../dev/demo-dataset/guard.ts';

function parseArgs(argv) {
  const args = { generation: DEFAULT_GENERATION };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--generation') args.generation = argv[++i];
    else if (flag === '--dataset') args.dataset = argv[++i];
    else if (flag === '--path') args.path = argv[++i];
    else throw new Error(`unknown flag: ${flag}`);
  }
  return args;
}

function resolveProjectLocalPath(override) {
  if (!override) return defaultDatabasePath();
  const resolved = resolve(process.cwd(), override);
  if (resolved !== process.cwd() && !resolved.startsWith(process.cwd() + sep))
    throw new Error(`--path must stay inside the project directory: ${resolved}`);
  return resolved;
}

function main() {
  assertDevelopment('demo-dataset remove CLI');
  const args = parseArgs(process.argv.slice(2));
  const path = resolveProjectLocalPath(args.path);
  const datasetIds = args.dataset ? [args.dataset] : Object.values(DATASET_IDS);

  const summary = { path, generation: args.generation, removed: [] };
  if (!existsSync(path)) {
    summary.note = 'database file absent; nothing to remove';
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }
  for (const datasetId of datasetIds) {
    removeDataset(path, datasetId, args.generation);
    summary.removed.push({ datasetId, generation: args.generation });
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`demo-dataset remove failed: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
}
