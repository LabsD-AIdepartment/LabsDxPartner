// Development-only seed / remove orchestration for the coherent partner-demo dataset. Pure over an
// injected clock + database path, so a CLI passes the real seed clock and tests pass a fixed one.
//
// Generation immutability (correction #5): a generation is written ONCE per authored anchor day.
// Reseeding the SAME datasetId+generation on the SAME anchor day is an idempotent no-op that keeps
// the ORIGINAL stored rows (never erasing a bootstrapped runtime); reseeding it for a DIFFERENT
// anchor day is REJECTED — a newly dated seed must use a NEW generation. Removal targets only the
// named datasetId+generation, preserving every other (sentinel) dataset.

import {
  buildDataset,
  DEFAULT_DATASET_ID,
  DEFAULT_GENERATION,
  validateDataset,
  type DatasetRecords,
} from './dataset';
import {
  deleteDataset,
  MissingDatabaseError,
  openDatabase,
  openExistingDatabaseReadOnly,
  readDataset,
  writeDataset,
  type Db,
} from './db';

export interface SeedOptions {
  path: string;
  datasetId?: string;
  generation?: string;
  asOf: Date;
  anchorDate?: string;
  allowOutOfPeriod?: boolean;
}
export interface SeedResult {
  datasetId: string;
  generation: string;
  asOf: string;
  anchorDate: string;
  /** 'written' = rows inserted; 'unchanged' = same-day idempotent no-op (original rows kept). */
  outcome: 'written' | 'unchanged';
  counts: Record<string, number>;
  records: DatasetRecords;
}

/** Raised when a generation is reseeded for a DIFFERENT anchor day (immutability violation). */
export class DatasetImmutabilityError extends Error {
  constructor(
    readonly datasetId: string,
    readonly generation: string,
    readonly storedAnchor: string,
    readonly requestedAnchor: string,
  ) {
    super(
      `dataset ${datasetId}/${generation} is already seeded for anchor ${storedAnchor}; ` +
        `a new anchor (${requestedAnchor}) requires a NEW generation (generations are immutable).`,
    );
    this.name = 'DatasetImmutabilityError';
  }
}

function counts(records: DatasetRecords): Record<string, number> {
  return {
    earnings: records.earnings.length,
    allocations: records.allocations.length,
    clips: records.clips.length,
    statements: records.statements.length,
    settlements: records.settlements.length,
    withdrawals: records.withdrawals.length,
    deductions: records.deductions.length,
    beneficiaryAccounts: records.beneficiaryAccounts?.length ?? 0,
  };
}

/**
 * Idempotently seed the named dataset generation and read it back for verification.
 *  - Absent generation  → build + write, return { outcome:'written' }.
 *  - Same anchor day     → keep the ORIGINAL stored rows, return { outcome:'unchanged' }.
 *  - Different anchor day → throw DatasetImmutabilityError (bump the generation instead).
 */
export function seedDataset(options: SeedOptions): SeedResult {
  const datasetId = options.datasetId ?? DEFAULT_DATASET_ID;
  const generation = options.generation ?? DEFAULT_GENERATION;
  const records = validateDataset(
    buildDataset({
      datasetId,
      generation,
      asOf: options.asOf,
      anchorDate: options.anchorDate,
      allowOutOfPeriod: options.allowOutOfPeriod,
    }),
  );
  const db = openDatabase(options.path);
  try {
    const existing = readDataset(db, datasetId, generation);
    if (existing) {
      if (existing.meta.anchorDate !== records.meta.anchorDate)
        throw new DatasetImmutabilityError(
          datasetId,
          generation,
          existing.meta.anchorDate,
          records.meta.anchorDate,
        );
      // Same generation + same anchor day: idempotent no-op — keep the original rows untouched.
      return {
        datasetId,
        generation,
        asOf: existing.meta.asOf,
        anchorDate: existing.meta.anchorDate,
        outcome: 'unchanged',
        counts: counts(existing),
        records: existing,
      };
    }
    writeDataset(db, records, records.meta.asOf);
    const stored = readDataset(db, datasetId, generation);
    if (!stored) throw new Error('seedDataset: dataset missing immediately after write');
    return {
      datasetId,
      generation,
      asOf: stored.meta.asOf,
      anchorDate: stored.meta.anchorDate,
      outcome: 'written',
      counts: counts(stored),
      records: stored,
    };
  } finally {
    db.close();
  }
}

/** Remove ONLY the named dataset generation. Any other dataset/generation stays intact. */
export function removeDataset(path: string, datasetId: string, generation: string): void {
  const db = openDatabase(path);
  try {
    deleteDataset(db, datasetId, generation);
  } finally {
    db.close();
  }
}

/**
 * Load + VALIDATE a dataset generation for projection, READ-ONLY. Returns null when the database or
 * the dataset is absent (never a silent fallback and never creating/mutating the file). Throws
 * DatasetValidationError if the stored rows are corrupt — corrupt data must never reach display.
 */
export function loadDataset(
  path: string,
  datasetId: string = DEFAULT_DATASET_ID,
  generation: string = DEFAULT_GENERATION,
): DatasetRecords | null {
  let db: Db;
  try {
    db = openExistingDatabaseReadOnly(path);
  } catch (error) {
    if (error instanceof MissingDatabaseError) return null;
    throw error;
  }
  try {
    const raw = readDataset(db, datasetId, generation);
    return raw === null ? null : validateDataset(raw);
  } finally {
    db.close();
  }
}

export type { Db };
