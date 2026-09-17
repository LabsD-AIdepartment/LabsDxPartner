import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoProductionFixtures } from '../../scripts/verify-no-demo.mjs';
import { AD_PERFORMANCE_MARKER } from '../../dev/ad-performance/handler';

describe('ad-performance production marker boundary', () => {
  it('flags the snapshot marker if it ever leaks into a production build', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ad-perf-'));
    try {
      writeFileSync(join(dir, 'clean.js'), 'export const ok = 1;');
      expect(() => assertNoProductionFixtures(dir)).not.toThrow();
      writeFileSync(join(dir, 'leak.js'), `const x = '${AD_PERFORMANCE_MARKER}';`);
      expect(() => assertNoProductionFixtures(dir)).toThrow(/leaked into production/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the marker constant stable', () => {
    expect(AD_PERFORMANCE_MARKER).toBe('synthetic-ad-performance-snapshot');
  });
});
