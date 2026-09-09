import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Text } from '@/shared/ui/Text';

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : [];
  });
}
describe('portal typography contract', () => {
  it('keeps heading and label semantics independent from the visual preset', () => {
    render(
      <>
        <Text as="h2" variant="caption">
          รายละเอียดคลิป
        </Text>
        <Text as="label" htmlFor="query" variant="label">
          ค้นหา
        </Text>
        <input id="query" />
      </>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'รายละเอียดคลิป' })).toBeVisible();
    expect(screen.getByLabelText('ค้นหา')).toBeVisible();
  });
  it('centralizes font definitions and preserves the agreed readable minimum', () => {
    const source = readFileSync(resolve('src/shared/theme/typography.css'), 'utf8');
    expect(source).toMatch(/--text-caption-size:\s*16px/);
    expect(source).toMatch(/--text-body-size:\s*16px/);
    for (const file of [...cssFiles('src'), ...cssFiles('dev'), ...cssFiles('app')]) {
      if (file.endsWith('/typography.css')) continue;
      const css = readFileSync(file, 'utf8');
      expect(css, file).not.toMatch(/font-size:\s*(?:\d|clamp|calc|min|max)/);
      expect(css, file).not.toMatch(/font-family:\s*['"]/);
    }
  });
});
