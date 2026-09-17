import { describe, expect, it } from 'vitest';
import { initialReportContext, reportHref } from '@/shared/routing/report-context';

const ctx = { ...initialReportContext, from: '2026-07-01', toExclusive: '2026-10-01', origin: 'overview' as const };

describe('reportHref merges into a base query safely', () => {
  it('appends the report search to a bare path', () => {
    const url = new URL(reportHref('/overview-preview', ctx), 'https://x.test');
    expect(url.pathname).toBe('/overview-preview');
    expect(url.searchParams.get('from')).toBe('2026-07-01');
    expect(url.searchParams.get('toExclusive')).toBe('2026-10-01');
    expect(url.searchParams.get('origin')).toBe('overview');
  });
  it('preserves non-report base params (dev scenario/identity prefix)', () => {
    const url = new URL(
      reportHref('/withdrawal-preview?scenario=partner-demo&identity=a', ctx),
      'https://x.test',
    );
    expect(url.searchParams.get('scenario')).toBe('partner-demo');
    expect(url.searchParams.get('identity')).toBe('a');
    expect(url.searchParams.get('from')).toBe('2026-07-01');
  });
  it('drops stale report fields already present on the base path', () => {
    const url = new URL(
      reportHref('/x?from=2020-01-01&generation=old&scenario=keep', ctx),
      'https://x.test',
    );
    expect(url.searchParams.getAll('from')).toEqual(['2026-07-01']); // single, fresh value
    expect(url.searchParams.get('generation')).toBeNull(); // stale detail field removed
    expect(url.searchParams.get('scenario')).toBe('keep'); // non-report base param kept
  });
  it('keeps a trailing hash after the merged query', () => {
    expect(reportHref('/x#section', ctx)).toMatch(/^\/x\?[^#]*#section$/);
    const withQuery = reportHref('/x?scenario=a#section', ctx);
    expect(withQuery.endsWith('#section')).toBe(true);
    expect(new URL(withQuery, 'https://x.test').searchParams.get('scenario')).toBe('a');
  });
});
