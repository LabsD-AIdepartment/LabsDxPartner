// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { it, expect } from 'vitest';

it('covers every declared API HTTP export with exactly one static-template observer', () => {
  const root = process.cwd();
  let routes = 0;
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'route.ts') {
        routes++;
        const source = readFileSync(path, 'utf8');
        const template = '/' + relative(resolve(root, 'app'), path).replace(/\/route\.ts$/, '');
        const methods = [...source.matchAll(/export\s+(?:(?:async\s+)?function|const)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g)].map(m => m[1]);
        expect(methods.length, path).toBeGreaterThan(0);
        expect(source, path).not.toMatch(/export\s*\{/); // aliases must be explicitly reviewed
        for (const method of methods) {
          expect(source, path).toContain(`export const ${method} = observeApi('${template}', handle${method});`);
          expect(source, path).not.toContain(`= ${method};`); // prevent HEAD wrapping an observed GET twice
        }
        expect([...source.matchAll(/observeApi\(/g)].length, path).toBe(methods.length);
      }
    }
  }
  visit(resolve(root, 'app/api'));
  expect(routes).toBeGreaterThan(0);
});
