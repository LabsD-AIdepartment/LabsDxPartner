// Development-only SQLite persistence for the coherent partner-demo dataset, using the Node builtin
// `node:sqlite` (NO new npm dependency). All money columns are TEXT so integer-satang BigInt values
// round-trip exactly. Every data row carries explicit dataset_id + generation and is keyed by the
// COMPOUND primary key (dataset_id, generation, id) so the SAME local id (e.g. `clip-row-1`) can
// coexist across datasets a/b AND across generations g1/g2 without a global-id collision. Sample
// metadata lives in a SEPARATE `dataset_meta` table. This module is never imported from app/.
//
// This is a BRAND-NEW, unapplied, project-local database file (see guard.defaultDatabasePath); it is
// NOT one of the live applied Drizzle/Postgres migrations, so redefining its schema here is safe.

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type {
  AllocationRow,
  BeneficiaryAccountRow,
  ClipRow,
  DatasetRecords,
  DeductionRow,
  EarningRow,
  MetaRow,
  SettlementRow,
  StatementRow,
  WithdrawalRow,
} from './dataset';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dataset_meta (
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  as_of TEXT NOT NULL,
  timezone TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, generation)
);
CREATE TABLE IF NOT EXISTS earning_record (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  content_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  rate_ppm INTEGER NOT NULL,
  earned_date TEXT NOT NULL,
  status TEXT NOT NULL,
  released INTEGER NOT NULL,
  eligible_base_minor TEXT NOT NULL,
  amount_minor TEXT NOT NULL,
  kind TEXT NOT NULL,
  attribution TEXT NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS sales_platform_alloc (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  platform TEXT NOT NULL,
  weight INTEGER NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS content_clip (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  content_id TEXT NOT NULL,
  title TEXT NOT NULL,
  brand TEXT NOT NULL,
  published_date TEXT NOT NULL,
  cover TEXT NOT NULL,
  cover_position TEXT NOT NULL,
  views INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  ad_bound INTEGER NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS statement_record (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  version TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to_excl TEXT NOT NULL,
  published_at TEXT NOT NULL,
  settlement_as_of TEXT NOT NULL,
  status TEXT NOT NULL,
  opening_minor TEXT NOT NULL,
  adjustments_minor TEXT NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS settlement_record (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  statement_id TEXT NOT NULL,
  settlement_id TEXT NOT NULL,
  reference TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  cash_minor TEXT NOT NULL,
  withholding_minor TEXT NOT NULL,
  other_minor TEXT NOT NULL,
  obligation_settled_minor TEXT NOT NULL,
  withdrawal_ref TEXT,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS withdrawal_record (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  request_ref TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  gross_minor TEXT NOT NULL,
  net_minor TEXT NOT NULL,
  status TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  paid_at TEXT,
  beneficiary_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  masked_account TEXT NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS withdrawal_deduction (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  request_ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_minor TEXT NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
CREATE TABLE IF NOT EXISTS beneficiary_account (
  id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  beneficiary_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  masked_account TEXT NOT NULL,
  full_account TEXT NOT NULL,
  synthetic INTEGER NOT NULL,
  PRIMARY KEY (dataset_id, generation, id)
);
`;

const DATA_TABLES = [
  'earning_record',
  'sales_platform_alloc',
  'content_clip',
  'statement_record',
  'settlement_record',
  'withdrawal_record',
  'withdrawal_deduction',
  // D168 additive table. Listed here so scoped write/remove cover it; the READ path tolerates its
  // absence in an older database (see readDataset), so an unapplied older DB never errors.
  'beneficiary_account',
];

/**
 * Open (creating the file + schema if needed) a WRITABLE dataset database at `path` (or ':memory:').
 * Only the seed/remove CLIs use this path — the read/handler path is strictly read-only.
 */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  // Rollback-journal (the SQLite default) leaves NO persistent side files after a clean close, so the
  // strictly read-only reader (openExistingDatabaseReadOnly) never has to touch a -wal/-shm file.
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec(SCHEMA);
  return db;
}

/** Raised when a read-only open is attempted against a database file that does not exist. */
export class MissingDatabaseError extends Error {
  constructor(readonly path: string) {
    super(`demo-dataset: no seeded database at ${path} (seed it first; the read path never creates one)`);
    this.name = 'MissingDatabaseError';
  }
}

/**
 * Open an EXISTING dataset database READ-ONLY. Never creates the file, never runs DDL/PRAGMA, never
 * mutates the schema — the read path (dev GET handler) must not resurrect or migrate a database. A
 * missing file raises `MissingDatabaseError` so the caller can answer 404 instead of 200.
 */
export function openExistingDatabaseReadOnly(path: string): Db {
  if (path !== ':memory:' && !existsSync(path)) throw new MissingDatabaseError(path);
  return new DatabaseSync(path, { readOnly: true });
}

/** Delete ONLY the named dataset+generation rows across every table, in one transaction. */
export function deleteDataset(db: Db, datasetId: string, generation: string): void {
  db.exec('BEGIN');
  try {
    for (const table of [...DATA_TABLES, 'dataset_meta'])
      db.prepare(`DELETE FROM ${table} WHERE dataset_id = ? AND generation = ?`).run(
        datasetId,
        generation,
      );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Idempotently write a dataset generation: delete its existing rows then insert the authored rows,
 * all inside a single transaction. Re-running with the same records yields identical contents.
 * `createdAt` is recorded on the meta row only (not shifted into the financial records).
 */
export function writeDataset(db: Db, records: DatasetRecords, createdAt: string): void {
  const { datasetId, generation } = records.meta;
  db.exec('BEGIN');
  try {
    for (const table of [...DATA_TABLES, 'dataset_meta'])
      db.prepare(`DELETE FROM ${table} WHERE dataset_id = ? AND generation = ?`).run(
        datasetId,
        generation,
      );

    db.prepare(
      `INSERT INTO dataset_meta (dataset_id, generation, as_of, timezone, anchor_date, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      records.meta.datasetId,
      records.meta.generation,
      records.meta.asOf,
      records.meta.timezone,
      records.meta.anchorDate,
      records.meta.note,
      createdAt,
    );

    const earning = db.prepare(
      `INSERT INTO earning_record
        (id, dataset_id, generation, source_ref, content_id, channel, rate_ppm, earned_date, status,
         released, eligible_base_minor, amount_minor, kind, attribution)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of records.earnings)
      earning.run(
        r.id, r.datasetId, r.generation, r.sourceRef, r.contentId, r.channel, r.ratePpm,
        r.earnedDate, r.status, r.released ? 1 : 0, r.eligibleBaseMinor, r.amountMinor, r.kind,
        r.attribution,
      );

    const alloc = db.prepare(
      `INSERT INTO sales_platform_alloc (id, dataset_id, generation, source_ref, platform, weight)
       VALUES (?,?,?,?,?,?)`,
    );
    for (const r of records.allocations)
      alloc.run(r.id, r.datasetId, r.generation, r.sourceRef, r.platform, r.weight);

    const clip = db.prepare(
      `INSERT INTO content_clip
        (id, dataset_id, generation, content_id, title, brand, published_date, cover,
         cover_position, views, removed, ad_bound)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of records.clips)
      clip.run(
        r.id, r.datasetId, r.generation, r.contentId, r.title, r.brand, r.publishedDate, r.cover,
        r.coverPosition, r.views, r.removed ? 1 : 0, r.adBound ? 1 : 0,
      );

    const statement = db.prepare(
      `INSERT INTO statement_record
        (id, dataset_id, generation, statement_id, version, period_from, period_to_excl,
         published_at, settlement_as_of, status, opening_minor, adjustments_minor)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of records.statements)
      statement.run(
        r.id, r.datasetId, r.generation, r.statementId, r.version, r.periodFrom, r.periodToExcl,
        r.publishedAt, r.settlementAsOf, r.status, r.openingMinor, r.adjustmentsMinor,
      );

    const settlement = db.prepare(
      `INSERT INTO settlement_record
        (id, dataset_id, generation, statement_id, settlement_id, reference, recorded_at, cash_minor,
         withholding_minor, other_minor, obligation_settled_minor, withdrawal_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of records.settlements)
      settlement.run(
        r.id, r.datasetId, r.generation, r.statementId, r.settlementId, r.reference, r.recordedAt,
        r.cashMinor, r.withholdingMinor, r.otherMinor, r.obligationSettledMinor, r.withdrawalRef,
      );

    const withdrawal = db.prepare(
      `INSERT INTO withdrawal_record
        (id, dataset_id, generation, request_ref, idempotency_key, gross_minor, net_minor, status,
         submitted_at, paid_at, beneficiary_name, bank_name, masked_account)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const r of records.withdrawals)
      withdrawal.run(
        r.id, r.datasetId, r.generation, r.requestRef, r.idempotencyKey, r.grossMinor, r.netMinor,
        r.status, r.submittedAt, r.paidAt, r.beneficiaryName, r.bankName, r.maskedAccount,
      );

    const deduction = db.prepare(
      `INSERT INTO withdrawal_deduction
        (id, dataset_id, generation, request_ref, kind, label, amount_minor)
       VALUES (?,?,?,?,?,?,?)`,
    );
    for (const r of records.deductions)
      deduction.run(r.id, r.datasetId, r.generation, r.requestRef, r.kind, r.label, r.amountMinor);

    const beneficiaryAccount = db.prepare(
      `INSERT INTO beneficiary_account
        (id, dataset_id, generation, beneficiary_name, bank_name, masked_account, full_account, synthetic)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const r of records.beneficiaryAccounts ?? [])
      beneficiaryAccount.run(
        r.id, r.datasetId, r.generation, r.beneficiaryName, r.bankName, r.maskedAccount, r.fullAccount,
        r.synthetic ? 1 : 0,
      );

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---- typed readers (reconstruct the authored row types exactly) ----------------------------------

type SqlRow = Record<string, string | number | bigint | null>;
const str = (v: SqlRow[string]): string => String(v);
const num = (v: SqlRow[string]): number => Number(v);
const bool = (v: SqlRow[string]): boolean => Number(v) === 1;

function all(db: Db, sql: string, datasetId: string, generation: string): SqlRow[] {
  return db.prepare(sql).all(datasetId, generation) as SqlRow[];
}

/** Whether a table exists — lets the read path tolerate an OLDER database without the additive table. */
function tableExists(db: Db, table: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined
  );
}

/** Load the full record set for one dataset generation, or null when absent. */
export function readDataset(db: Db, datasetId: string, generation: string): DatasetRecords | null {
  const metaRow = db
    .prepare('SELECT * FROM dataset_meta WHERE dataset_id = ? AND generation = ?')
    .get(datasetId, generation) as SqlRow | undefined;
  if (!metaRow) return null;
  const meta: MetaRow = {
    datasetId: str(metaRow.dataset_id),
    generation: str(metaRow.generation),
    asOf: str(metaRow.as_of),
    timezone: 'Asia/Bangkok',
    anchorDate: str(metaRow.anchor_date),
    note: str(metaRow.note),
  };

  const earnings: EarningRow[] = all(
    db,
    'SELECT * FROM earning_record WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    sourceRef: str(r.source_ref),
    contentId: str(r.content_id),
    channel: str(r.channel) as EarningRow['channel'],
    ratePpm: num(r.rate_ppm),
    earnedDate: str(r.earned_date),
    status: str(r.status) as EarningRow['status'],
    released: bool(r.released),
    eligibleBaseMinor: str(r.eligible_base_minor),
    amountMinor: str(r.amount_minor),
    kind: 'commission',
    attribution: str(r.attribution) as EarningRow['attribution'],
  }));

  const allocations: AllocationRow[] = all(
    db,
    'SELECT * FROM sales_platform_alloc WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    sourceRef: str(r.source_ref),
    platform: str(r.platform) as AllocationRow['platform'],
    weight: num(r.weight),
  }));

  const clips: ClipRow[] = all(
    db,
    'SELECT * FROM content_clip WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    contentId: str(r.content_id),
    title: str(r.title),
    brand: str(r.brand),
    publishedDate: str(r.published_date),
    cover: str(r.cover),
    coverPosition: str(r.cover_position),
    views: num(r.views),
    removed: bool(r.removed),
    adBound: bool(r.ad_bound),
  }));

  const statements: StatementRow[] = all(
    db,
    'SELECT * FROM statement_record WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    statementId: str(r.statement_id),
    version: str(r.version),
    periodFrom: str(r.period_from),
    periodToExcl: str(r.period_to_excl),
    publishedAt: str(r.published_at),
    settlementAsOf: str(r.settlement_as_of),
    status: str(r.status),
    openingMinor: str(r.opening_minor),
    adjustmentsMinor: str(r.adjustments_minor),
  }));

  const settlements: SettlementRow[] = all(
    db,
    'SELECT * FROM settlement_record WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    statementId: str(r.statement_id),
    settlementId: str(r.settlement_id),
    reference: str(r.reference),
    recordedAt: str(r.recorded_at),
    cashMinor: str(r.cash_minor),
    withholdingMinor: str(r.withholding_minor),
    otherMinor: str(r.other_minor),
    obligationSettledMinor: str(r.obligation_settled_minor),
    withdrawalRef: r.withdrawal_ref === null ? null : str(r.withdrawal_ref),
  }));

  const withdrawals: WithdrawalRow[] = all(
    db,
    'SELECT * FROM withdrawal_record WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    requestRef: str(r.request_ref),
    idempotencyKey: str(r.idempotency_key),
    grossMinor: str(r.gross_minor),
    netMinor: str(r.net_minor),
    status: str(r.status) as WithdrawalRow['status'],
    submittedAt: str(r.submitted_at),
    paidAt: r.paid_at === null ? null : str(r.paid_at),
    beneficiaryName: str(r.beneficiary_name),
    bankName: str(r.bank_name),
    maskedAccount: str(r.masked_account),
  }));

  const deductions: DeductionRow[] = all(
    db,
    'SELECT * FROM withdrawal_deduction WHERE dataset_id = ? AND generation = ? ORDER BY id',
    datasetId,
    generation,
  ).map((r) => ({
    id: str(r.id),
    datasetId: str(r.dataset_id),
    generation: str(r.generation),
    requestRef: str(r.request_ref),
    kind: str(r.kind),
    label: str(r.label),
    amountMinor: str(r.amount_minor),
  }));

  // Additive: an older database may predate this table. Absent ⇒ [], so old DBs read fine and expose
  // no reveal (validateDataset later enforces `synthetic === true` + mask/full consistency on real rows).
  const beneficiaryAccounts: BeneficiaryAccountRow[] = tableExists(db, 'beneficiary_account')
    ? all(
        db,
        'SELECT * FROM beneficiary_account WHERE dataset_id = ? AND generation = ? ORDER BY id',
        datasetId,
        generation,
      ).map((r) => ({
        id: str(r.id),
        datasetId: str(r.dataset_id),
        generation: str(r.generation),
        beneficiaryName: str(r.beneficiary_name),
        bankName: str(r.bank_name),
        maskedAccount: str(r.masked_account),
        fullAccount: str(r.full_account),
        synthetic: bool(r.synthetic) as true,
      }))
    : [];

  return {
    meta,
    earnings,
    allocations,
    clips,
    statements,
    settlements,
    withdrawals,
    deductions,
    beneficiaryAccounts,
  };
}
