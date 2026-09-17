// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
  symlinkSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkerJournal } from '@/server/modules/marketing-ads/worker-journal.mjs';
import { createWorkerEvents } from '@/server/modules/marketing-ads/worker-events.mjs';

const base = resolve('.agent-work/20260911-worker-journal/tmp');
mkdirSync(base, { recursive: true });
function directory() {
  return mkdtempSync(resolve(base, 'journal-'));
}
function contents(path: string) {
  return readdirSync(path)
    .filter((name) => /^events-\d{12}\.jsonl$/.test(name))
    .sort()
    .flatMap((name) =>
      readFileSync(resolve(path, name), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
}

describe('bounded worker journal', () => {
  it('rotates complete correlated JSON lines and bounds files/bytes without touching unrelated files', () => {
    const path = directory();
    writeFileSync(resolve(path, 'keep.txt'), 'unrelated');
    const journal = createWorkerJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
    const events = createWorkerEvents('facebook', (event) => {
      expect(journal.write(event)).toBe(true);
    });
    for (let i = 0; i < 30; i++) events.record({ state: 'running', starts: 1 });
    expect(journal.status()).toEqual({ state: 'ready', lastStoredSequence: 30 });
    journal.close();
    const files = readdirSync(path).filter((name) => name.endsWith('.jsonl'));
    expect(files).toHaveLength(3);
    for (const name of files) {
      const stat = statSync(resolve(path, name));
      expect(stat.size).toBeLessThanOrEqual(1024);
      expect(stat.mode & 0o777).toBe(0o600);
    }
    const rows = contents(path);
    expect(rows.at(-1).sequence).toBe(30);
    expect(rows.map((row) => row.sequence)).toEqual(
      Array.from({ length: rows.length }, (_, i) => 31 - rows.length + i),
    );
    expect(new Set(rows.map((row) => row.supervisorRunId)).size).toBe(1);
    expect(readFileSync(resolve(path, 'keep.txt'), 'utf8')).toBe('unrelated');
  });

  it('keeps separate process runs and starts a new segment after an interrupted partial line', () => {
    const path = directory();
    writeFileSync(resolve(path, 'events-000000000001.jsonl'), '{"interrupted":', { mode: 0o600 });
    const first = createWorkerJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
    const a = createWorkerEvents('tiktok', (event) => first.write(event)).record({
      state: 'backoff',
      reason: 'exited',
    });
    first.close();
    const second = createWorkerJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
    const b = createWorkerEvents('tiktok', (event) => second.write(event)).record({
      state: 'starting',
    });
    second.close();
    expect(readFileSync(resolve(path, 'events-000000000001.jsonl'), 'utf8')).toBe(
      '{"interrupted":',
    );
    expect(JSON.parse(readFileSync(resolve(path, 'events-000000000002.jsonl'), 'utf8'))).toEqual(a);
    expect(JSON.parse(readFileSync(resolve(path, 'events-000000000003.jsonl'), 'utf8'))).toEqual(b);
    expect(a.supervisorRunId).not.toBe(b.supervisorRunId);
  });

  it('reports storage failure without throwing into supervision or leaking unexpected payloads', () => {
    const path = directory();
    const journal = createWorkerJournal({ directory: path, maxBytes: 1024, maxFiles: 3 });
    const events = createWorkerEvents('facebook', (event) => journal.write(event));
    events.record({ state: 'starting' });
    renameSync(path, path + '-moved');
    expect(() => events.record({ state: 'running' })).not.toThrow();
    expect(journal.status()).toEqual({ state: 'unavailable', lastStoredSequence: 1 });
    journal.close();
    expect(journal.status().state).toBe('unavailable');
    const clean = createWorkerJournal({ directory: directory(), maxBytes: 1024, maxFiles: 3 });
    expect(clean.write({ schemaVersion: 1, token: 'must-not-be-written' })).toBe(false);
    expect(clean.status().state).toBe('unavailable');
    clean.close();
  });

  it('rejects unbounded configuration and unsafe stored paths without modifying their target', () => {
    for (const maxFiles of [0, 101, NaN])
      expect(() =>
        createWorkerJournal({ directory: directory(), maxBytes: 1024, maxFiles }),
      ).toThrow();
    for (const maxBytes of [0, Infinity, 17 * 1024 * 1024])
      expect(() =>
        createWorkerJournal({ directory: directory(), maxBytes, maxFiles: 3 }),
      ).toThrow();
    const target = directory(),
      path = directory();
    writeFileSync(resolve(target, 'keep'), 'original');
    symlinkSync(resolve(target, 'keep'), resolve(path, 'events-000000000001.jsonl'));
    const journal = createWorkerJournal({ directory: path, maxBytes: 1024, maxFiles: 1 });
    expect(journal.status().state).toBe('unavailable');
    expect(readFileSync(resolve(target, 'keep'), 'utf8')).toBe('original');
    expect(readdirSync(path)).toHaveLength(1);
    journal.close();
  });
});
