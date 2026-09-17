// @vitest-environment node
//
// System tests for the development-only coherent partner-demo dataset storage layer (author-owned):
// compound-key isolation, seed immutability/idempotence, scoped removal, raw-read validation,
// read-only missing-DB behaviour, and the guarded dev GET handler (incl. the production stub).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  addDays,
  buildDataset,
  DATASET_IDS,
  DEFAULT_GENERATION,
  DEMO_DATASET_MARKER,
  DatasetValidationError,
  validateDataset,
  type DatasetRecords,
} from '../../dev/demo-dataset/dataset';
import { defaultDatabasePath } from '../../dev/demo-dataset/guard';
import {
  MissingDatabaseError,
  openDatabase,
  openExistingDatabaseReadOnly,
  readDataset,
} from '../../dev/demo-dataset/db';
import {
  DatasetImmutabilityError,
  loadDataset,
  removeDataset,
  seedDataset,
} from '../../dev/demo-dataset/seed';
import { handleDemoDatasetRequest } from '../../dev/demo-dataset/handler';
import { handleDemoDatasetRequest as handleUnavailable } from '../../dev/demo-dataset/handler.unavailable';

const SENTINEL_ID = 'sentinel-demo';
const AS_OF = new Date('2026-09-17T09:00:00+07:00');
const AS_OF_LATER = new Date('2026-09-17T14:30:00+07:00'); // same anchor day, different clock time
const NEXT_DAY = new Date('2026-09-18T09:00:00+07:00'); // different anchor day

let dir: string;
const dbAt = (name: string) => join(dir, name);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'demo-dataset-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const sum = (values: string[]): bigint => values.reduce((t, v) => t + BigInt(v), 0n);

describe('authored dataset passes its own validator and carries expected figures', () => {
  const records = buildDataset({ datasetId: DATASET_IDS.a, generation: 'g1', asOf: AS_OF });

  it('validates and round-trips through validateDataset unchanged', () => {
    expect(() => validateDataset(records)).not.toThrow();
    expect(validateDataset(records)).toEqual(records);
  });

  it('has the derived never-zero record counts (Sep-17 anchor)', () => {
    // 62 closed daily lines (Jul-01..Aug-31, one per calendar day) + 17 September confirmed days
    // (Sep-01..Sep-17) + 2 estimated rows.
    const CLOSED_DAILY = 62;
    const SEPT_CONFIRMED = 17;
    const ESTIMATED = 2;
    expect(records.earnings).toHaveLength(CLOSED_DAILY + SEPT_CONFIRMED + ESTIMATED); // 81
    // Closed allocations = Σ(clip's named platform weights × that clip's assigned days):
    //   clip1 5×11 + clip2 2×11 + clip3 3×10 + clip4 5×10 + clip5 2×10 + clip6 1×10 = 187,
    // plus one named allocation per September confirmed day and per estimated row.
    const CLOSED_ALLOCS = 5 * 11 + 2 * 11 + 3 * 10 + 5 * 10 + 2 * 10 + 1 * 10; // 187
    expect(records.allocations).toHaveLength(CLOSED_ALLOCS + SEPT_CONFIRMED + ESTIMATED); // 206
    expect(records.clips).toHaveLength(8);
    expect(records.statements).toHaveLength(1);
    expect(records.settlements).toHaveLength(4);
    expect(records.withdrawals).toHaveLength(5);
    expect(records.deductions).toHaveLength(0);
  });

  it('every Bangkok day Jul-01..anchor carries a positive confirmed earning (never a zero day)', () => {
    const confirmed = records.earnings.filter((e) => e.status === 'confirmed');
    for (const e of confirmed) expect(BigInt(e.amountMinor) > 0n).toBe(true);
    const covered = new Set(confirmed.map((e) => e.earnedDate));
    for (let day = '2026-07-01'; day <= records.meta.anchorDate; day = addDays(day, 1))
      expect(covered.has(day)).toBe(true);
    const sorted = [...covered].sort();
    expect(sorted[0]).toBe('2026-07-01'); // spans the full closed period from Jul-01…
    expect(sorted.at(-1)).toBe(records.meta.anchorDate); // …through the anchor, with no future day
  });

  it('every earning uses an exact rate ≥ 3% that reconciles amount to eligibleBase', () => {
    for (const e of records.earnings) {
      expect(e.ratePpm).toBeGreaterThanOrEqual(30000); // ≥ 3%
      expect(BigInt(e.amountMinor) * 1_000_000n).toBe(
        BigInt(e.eligibleBaseMinor) * BigInt(e.ratePpm),
      );
    }
  });

  it('closed per-clip released totals (and the 5,500,000 THB sales base) are unchanged', () => {
    const expected: Record<string, string> = {
      'clip-1': '12800000',
      'clip-2': '3120000',
      'clip-3': '9600000',
      'clip-4': '2580000',
      'clip-5': '7400000',
      'clip-6': '1860000',
    };
    const byClip: Record<string, bigint> = {};
    for (const e of records.earnings.filter((e) => e.released))
      byClip[e.contentId] = (byClip[e.contentId] ?? 0n) + BigInt(e.amountMinor);
    for (const [clip, total] of Object.entries(expected))
      expect((byClip[clip] ?? 0n).toString()).toBe(total);
    expect(
      sum(records.earnings.filter((e) => e.released).map((e) => e.eligibleBaseMinor)).toString(),
    ).toBe('550000000'); // 5,500,000 THB eligible sales base
  });

  it('September confirmed = 322,000 THB (latest-7 = 133,000) with no zero day at the Sep-17 anchor', () => {
    const sept = records.earnings.filter(
      (e) => e.status === 'confirmed' && !e.released && e.earnedDate >= '2026-09-01',
    );
    expect(sum(sept.map((e) => e.amountMinor)).toString()).toBe('32200000'); // 322,000 THB
    const anchor = records.meta.anchorDate;
    const latest7 = sept.filter((e) => e.earnedDate > addDays(anchor, -7));
    expect(sum(latest7.map((e) => e.amountMinor)).toString()).toBe('13300000'); // 133,000 THB
    const sep12 = sept.find((e) => e.earnedDate === '2026-09-12'); // former zero day (offset 5)
    expect(sep12?.amountMinor).toBe('1600000'); // now 16,000 THB, never zero
  });

  it('preserves the two estimated rows (70,000 THB) on/before the anchor', () => {
    const est = records.earnings.filter((e) => e.status === 'estimated');
    expect(est).toHaveLength(2);
    expect(sum(est.map((e) => e.amountMinor)).toString()).toBe('7000000'); // 70,000 THB
    for (const e of est) expect(e.earnedDate <= records.meta.anchorDate).toBe(true);
  });

  it('no earning is after the anchor or before its clip publishedDate', () => {
    const publishedByClip = new Map(records.clips.map((c) => [c.contentId, c.publishedDate]));
    for (const e of records.earnings) {
      expect(e.earnedDate <= records.meta.anchorDate).toBe(true);
      const published = publishedByClip.get(e.contentId);
      if (published) expect(e.earnedDate >= published).toBe(true);
    }
    // Closed clips are (re)published on their earliest assigned date, Jul-01..Jul-06.
    for (let i = 1; i <= 6; i++)
      expect(publishedByClip.get(`clip-${i}`)).toBe(addDays('2026-07-01', i - 1));
  });

  it('every earnings source has at least one named (non-unattributed) platform allocation', () => {
    const namedSources = new Set(
      records.allocations
        .filter((a) => a.platform !== 'unattributed')
        .map((a) => a.sourceRef),
    );
    for (const e of records.earnings)
      expect(namedSources.has(e.sourceRef)).toBe(true);
    // No source resolves to the unattributed fallback (accepted UI excludes unattributed rows).
    expect(records.allocations.some((a) => a.platform === 'unattributed')).toBe(false);
  });

  it('released pool = 373,600 THB and paid settlements = 100,000 THB, rates stay clean', () => {
    const released = records.earnings.filter((e) => e.released).map((e) => e.amountMinor);
    expect(sum(released).toString()).toBe('37360000'); // 373,600.00 THB
    expect(sum(records.settlements.map((s) => s.obligationSettledMinor)).toString()).toBe('10000000');
    for (const e of records.earnings)
      expect(e.ratePpm).toBe(e.channel === 'organic' ? 100000 : 30000);
  });

  it('chronology: first paid submitted at Sep-01 (release), all paid after Sep-01, none after asOf', () => {
    const paid = records.withdrawals.filter((w) => w.status === 'paid');
    const submitted = paid.map((w) => w.submittedAt).sort();
    expect(submitted[0]).toBe('2026-09-01T12:00:00+07:00'); // == paid-1 day, after the Sep-01 release
    expect(records.statements[0].publishedAt).toBe('2026-09-01T09:00:00+07:00');
    expect(Date.parse(submitted[0])).toBeGreaterThan(
      Date.parse(records.statements[0].publishedAt),
    );
    for (const w of paid) {
      expect(w.paidAt).not.toBeNull();
      expect(w.paidAt! > '2026-09-01').toBe(true);
      expect(Date.parse(w.paidAt!)).toBeLessThanOrEqual(AS_OF.getTime());
      expect(Date.parse(w.submittedAt)).toBeGreaterThanOrEqual(
        Date.parse(records.statements[0].publishedAt),
      );
    }
  });

  it('embeds the fixture marker in the meta note for production-leak detection', () => {
    expect(records.meta.note).toContain(DEMO_DATASET_MARKER);
  });
});

describe('compound (dataset_id, generation, id) key isolates a/b, sentinel, and g1/g2/g3', () => {
  it('seeds a+b+sentinel+g2+g3 with colliding local ids that coexist, then read back in scope', () => {
    const path = dbAt('isolation.sqlite');
    const a1 = seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g1', asOf: AS_OF });
    const b1 = seedDataset({ path, datasetId: DATASET_IDS.b, generation: 'g1', asOf: AS_OF });
    const s1 = seedDataset({ path, datasetId: SENTINEL_ID, generation: 'g1', asOf: AS_OF });
    const a2 = seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g2', asOf: AS_OF });
    // The historical never-zero g3 generation must coexist with immutable g1/g2 rows,
    // independently of whichever generation the server currently selects by default.
    const a3 = seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g3', asOf: AS_OF });

    for (const r of [a1, b1, s1, a2, a3]) expect(r.outcome).toBe('written');
    expect(a3.records.meta.generation).toBe('g3');

    // The SAME local id exists across every scope — only the compound key keeps them distinct.
    expect(a1.records.clips[0].id).toBe(a2.records.clips[0].id);
    expect(a1.records.clips[0].id).toBe(a3.records.clips[0].id);

    const db = openExistingDatabaseReadOnly(path);
    try {
      const readA1 = readDataset(db, DATASET_IDS.a, 'g1')!;
      const readB1 = readDataset(db, DATASET_IDS.b, 'g1')!;
      const readS1 = readDataset(db, SENTINEL_ID, 'g1')!;
      const readA2 = readDataset(db, DATASET_IDS.a, 'g2')!;
      const readA3 = readDataset(db, DATASET_IDS.a, 'g3')!;
      expect(readA1.clips).toHaveLength(8);
      expect(readA2.clips).toHaveLength(8);
      expect(readA3.clips).toHaveLength(8);
      for (const row of readA1.earnings) expect(row.generation).toBe('g1');
      for (const row of readA2.earnings) expect(row.generation).toBe('g2');
      for (const row of readA3.earnings) expect(row.generation).toBe('g3');
      // g3 is the never-zero dataset: every confirmed line is strictly positive.
      for (const e of readA3.earnings)
        if (e.status === 'confirmed') expect(BigInt(e.amountMinor) > 0n).toBe(true);
      expect(readB1.meta.datasetId).toBe(DATASET_IDS.b);
      expect(readS1.meta.datasetId).toBe(SENTINEL_ID);
      // Cross-scope isolation: every read is confined to its own dataset_id + generation.
      expect(new Set(readA1.earnings.map((e) => e.datasetId))).toEqual(new Set([DATASET_IDS.a]));
      expect(new Set(readA3.earnings.map((e) => e.generation))).toEqual(new Set(['g3']));
    } finally {
      db.close();
    }
  });
});

describe('seed idempotence + generation immutability', () => {
  it('reseeding the same generation/anchor is a no-op that preserves the stored asOf', () => {
    const path = dbAt('idempotence.sqlite');
    const first = seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g1', asOf: AS_OF });
    expect(first.outcome).toBe('written');
    const again = seedDataset({
      path,
      datasetId: DATASET_IDS.a,
      generation: 'g1',
      asOf: AS_OF_LATER, // later clock, SAME anchor day
    });
    expect(again.outcome).toBe('unchanged');
    expect(again.asOf).toBe(first.asOf); // original stored asOf is retained, not overwritten
    expect(again.records).toEqual(first.records);
  });

  it('reseeding the same generation for a DIFFERENT anchor day is rejected', () => {
    const path = dbAt('immutable.sqlite');
    seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g1', asOf: AS_OF });
    expect(() =>
      seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g1', asOf: NEXT_DAY }),
    ).toThrow(DatasetImmutabilityError);
  });
});

describe('scoped removal only deletes the named dataset generation', () => {
  it('removes a/g1 while b/g1, sentinel/g1 and a/g2 remain intact', () => {
    const path = dbAt('removal.sqlite');
    seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g1', asOf: AS_OF });
    seedDataset({ path, datasetId: DATASET_IDS.b, generation: 'g1', asOf: AS_OF });
    seedDataset({ path, datasetId: SENTINEL_ID, generation: 'g1', asOf: AS_OF });
    seedDataset({ path, datasetId: DATASET_IDS.a, generation: 'g2', asOf: AS_OF });

    removeDataset(path, DATASET_IDS.a, 'g1');

    expect(loadDataset(path, DATASET_IDS.a, 'g1')).toBeNull();
    expect(loadDataset(path, DATASET_IDS.b, 'g1')).not.toBeNull();
    expect(loadDataset(path, SENTINEL_ID, 'g1')).not.toBeNull();
    expect(loadDataset(path, DATASET_IDS.a, 'g2')).not.toBeNull();
  });
});

describe('raw read validation rejects corrupt data before it can display', () => {
  const base = (): DatasetRecords =>
    structuredClone(buildDataset({ datasetId: DATASET_IDS.a, generation: 'g1', asOf: AS_OF }));

  it('rejects a non-integer money value', () => {
    const bad = base();
    bad.earnings[0].amountMinor = '12.34';
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('rejects a rate that does not match the channel', () => {
    const bad = base();
    bad.earnings[0].ratePpm = 42;
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('rejects an out-of-scope row (wrong dataset_id)', () => {
    const bad = base();
    bad.clips[0].datasetId = 'someone-else';
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('rejects a dangling settlement→withdrawal reference', () => {
    const bad = base();
    bad.settlements[0].withdrawalRef = 'nope';
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('rejects a settlement whose cash no longer reconciles to the obligation', () => {
    const bad = base();
    bad.settlements[0].cashMinor = '1';
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('rejects an earned date after the anchor', () => {
    const bad = base();
    bad.earnings[0].earnedDate = '2026-09-30';
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('rejects a millisecond-Z asOf instant (must be Bangkok second precision)', () => {
    const bad = base();
    bad.meta.asOf = '2026-09-17T02:00:00.000Z';
    expect(() => validateDataset(bad)).toThrow(DatasetValidationError);
  });

  it('the corrupt DB fails the load path too', () => {
    const path = dbAt('corrupt.sqlite');
    const db = openDatabase(path);
    try {
      // Insert a valid-shaped meta but no rows, then corrupt one column directly is out of scope;
      // instead we prove loadDataset validates by writing a broken earning via the low-level API.
      db.exec('BEGIN');
      db.prepare(
        `INSERT INTO dataset_meta (dataset_id, generation, as_of, timezone, anchor_date, note, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(DATASET_IDS.a, 'g1', '2026-09-17T09:00:00+07:00', 'Asia/Bangkok', '2026-09-17', 'note', 'x');
      db.prepare(
        `INSERT INTO earning_record
          (id, dataset_id, generation, source_ref, content_id, channel, rate_ppm, earned_date, status,
           released, eligible_base_minor, amount_minor, kind, attribution)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run('x', DATASET_IDS.a, 'g1', 'sale-1', 'clip-1', 'organic', 100000, '2026-08-01', 'confirmed',
        1, '10', 'NOT-A-NUMBER', 'commission', 'content');
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    expect(() => loadDataset(path, DATASET_IDS.a, 'g1')).toThrow(DatasetValidationError);
  });
});

describe('read path is strictly read-only and never creates a database', () => {
  it('openExistingDatabaseReadOnly throws MissingDatabaseError without creating the file', () => {
    const path = dbAt('never-created.sqlite');
    expect(existsSync(path)).toBe(false);
    expect(() => openExistingDatabaseReadOnly(path)).toThrow(MissingDatabaseError);
    expect(existsSync(path)).toBe(false);
  });

  it('loadDataset returns null for a missing database and still does not create it', () => {
    const path = dbAt('missing-load.sqlite');
    expect(loadDataset(path, DATASET_IDS.a, 'g1')).toBeNull();
    expect(existsSync(path)).toBe(false);
  });
});

describe('defaultDatabasePath enforces a project-local DEMO_DATASET_DB override', () => {
  it('rejects an override that resolves outside process.cwd()', () => {
    vi.stubEnv('DEMO_DATASET_DB', '/tmp/outside-project-demo.sqlite');
    expect(() => defaultDatabasePath()).toThrow(/inside the project directory/);
  });

  it('accepts an override that stays inside process.cwd()', () => {
    vi.stubEnv('DEMO_DATASET_DB', '.agent-work/override/inside.sqlite');
    expect(() => defaultDatabasePath()).not.toThrow();
    expect(defaultDatabasePath().startsWith(process.cwd())).toBe(true);
  });
});

describe('dev GET handler', () => {
  const url = (identity: string) => `http://localhost/api/dev/demo-dataset?identity=${identity}`;

  it('returns 200 validated DatasetRecords for a seeded identity, with the marker header', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const path = dbAt('handler.sqlite');
    // Seed the server-owned DEFAULT_GENERATION so the handler (which reads DEFAULT_GENERATION) matches.
    seedDataset({ path, datasetId: DATASET_IDS.a, generation: DEFAULT_GENERATION, asOf: AS_OF });
    seedDataset({ path, datasetId: DATASET_IDS.b, generation: DEFAULT_GENERATION, asOf: AS_OF });

    const resA = await handleDemoDatasetRequest(new Request(url('a')), { databasePath: path });
    expect(resA.status).toBe(200);
    expect(resA.headers.get('x-demo-dataset')).toBe(DEMO_DATASET_MARKER);
    const bodyA = (await resA.json()) as DatasetRecords;
    expect(bodyA.meta.datasetId).toBe(DATASET_IDS.a);
    expect(() => validateDataset(bodyA)).not.toThrow();

    const resB = await handleDemoDatasetRequest(new Request(url('b')), { databasePath: path });
    expect(((await resB.json()) as DatasetRecords).meta.datasetId).toBe(DATASET_IDS.b);
  });

  it('masks every clip view count to null while the stored DB rows keep their real integers', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const path = dbAt('handler-views.sqlite');
    const seeded = seedDataset({
      path,
      datasetId: DATASET_IDS.a,
      generation: DEFAULT_GENERATION,
      asOf: AS_OF,
    });
    // The authored dataset carries positive integer view counts on its closed clips.
    expect(seeded.records.clips.some((c) => typeof c.views === 'number' && (c.views ?? 0) > 0)).toBe(
      true,
    );

    const res = await handleDemoDatasetRequest(new Request(url('a')), { databasePath: path });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DatasetRecords;
    // Public serialized copy: EVERY clip's audience view count is masked to null (never a raw count).
    expect(body.clips).toHaveLength(seeded.records.clips.length);
    expect(body.clips.every((c) => c.views === null)).toBe(true);
    // The masked copy still passes the shared validator (which now accepts a nullable view count).
    expect(() => validateDataset(body)).not.toThrow();

    // The stored DB rows / readDataset output are untouched: the real integers survive on disk.
    const db = openExistingDatabaseReadOnly(path);
    try {
      const stored = readDataset(db, DATASET_IDS.a, DEFAULT_GENERATION)!;
      expect(stored.clips.every((c) => typeof c.views === 'number')).toBe(true);
      expect(stored.clips.map((c) => c.views)).toEqual(seeded.records.clips.map((c) => c.views));
    } finally {
      db.close();
    }
  });

  it('returns 404 for an unknown identity', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const path = dbAt('handler.sqlite');
    const res = await handleDemoDatasetRequest(new Request(url('zzz')), { databasePath: path });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a missing seed without creating a database', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const path = dbAt('handler-missing.sqlite');
    const res = await handleDemoDatasetRequest(new Request(url('a')), { databasePath: path });
    expect(res.status).toBe(404);
    expect(existsSync(path)).toBe(false);
  });

  it('is forbidden (404) outside development even when a database exists', async () => {
    const path = dbAt('handler.sqlite'); // seeded above
    vi.stubEnv('NODE_ENV', 'production');
    const res = await handleDemoDatasetRequest(new Request(url('a')), { databasePath: path });
    expect(res.status).toBe(404);
  });

  it('the production stub always answers 404', async () => {
    const res = await handleUnavailable(new Request(url('a')));
    expect(res.status).toBe(404);
  });
});
