// @vitest-environment node
import { readdirSync } from 'node:fs';
import { it, expect } from 'vitest';
import templates from '@/server/platform/observability/route-templates.json';
it('keeps the redacted route catalogue in sync with all source pages and APIs', () => {
  const paths = new Set<string>();
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(path);
      else if (/^(page|route)\.tsx?$/.test(entry.name)) {
        const raw = path.slice(3).replace(/\.tsx?$/, '');
        const clean = raw.replace(/\/\([^/]+\)/g, '');
        for (const value of [raw, clean, clean.replace(/\/(page|route)$/, '') || '/']) {
          paths.add(value); paths.add('/app' + (value === '/' ? '' : value));
        }
      }
    }
  }
  walk('app');
  expect([...paths].sort()).toEqual(templates);
});
