import { beforeEach as brandBeforeEach, afterEach as brandAfterEach, vi as brandVi } from 'vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  changeReportFilters,
  initialReportContext,
  readReportContext,
  reportNavigationHrefs,
} from '@/shared/routing/report-context';
import { useReportState } from '@/shared/routing/useReportState';

const paths = { overview: '/overview', content: '/content', transactions: '/transactions' };
afterEach(() => window.history.replaceState(null, '', '/'));
describe('shared report navigation', () => {
  it('carries dates and brand but removes detail generation/cursors and overview-only search mismatch', () => {
    const c = {
      ...initialReportContext,
      q: 'เช้า',
      brand: 'Axtion',
      cursor: 'old',
      history: ['old'],
      generation: 'old-generation',
    };
    const links = reportNavigationHrefs(c, paths);
    const overview = new URL(links.overview, 'https://example.test');
    const content = new URL(links.content, 'https://example.test');
    expect(readReportContext(overview.searchParams)).toEqual({
      ...c,
      q: '',
      origin: 'overview',
      generation: null,
      cursor: null,
      history: [],
    });
    expect(readReportContext(content.searchParams)).toEqual({
      ...c,
      origin: 'content',
      generation: null,
      cursor: null,
      history: [],
    });
    const transactions = new URL(links.transactions, 'https://example.test');
    expect(transactions.searchParams.get('returnTo')).toBe(links.content);
    expect(transactions.searchParams.get('from')).toBe(c.from);
  });
  it('keeps invalid drafts editable, sends no invalid navigation filters, and preserves Next history metadata', () => {
    window.history.replaceState(
      { __NA: true, tree: 'router-state' },
      '',
      '/content?from=2026-07-01',
    );
    const { result } = renderHook(() =>
      useReportState(initialReportContext, 'partner-1:revision-1', '/content'),
    );
    act(() => result.current[1](changeReportFilters(result.current[0], { from: '' })));
    expect(result.current[0].from).toBe('');
    expect(window.location.search).toBe('?from=2026-07-01');
    expect(reportNavigationHrefs(result.current[0], paths)).toEqual(paths);
    act(() => result.current[1](changeReportFilters(result.current[0], { from: '2026-08-01' })));
    expect(new URLSearchParams(window.location.search).get('from')).toBe('2026-08-01');
    expect(window.history.state).toEqual({ __NA: true, tree: 'router-state' });
  });
  it('restores URL state on same-page back/forward and resets edits on new route or permission inputs', () => {
    window.history.replaceState(null, '', '/content');
    const { result, rerender } = renderHook(
      ({ identity, initial }) => useReportState(initial, identity, '/content'),
      {
        initialProps: { identity: 'p1:r1', initial: initialReportContext },
      },
    );
    act(() => result.current[1](changeReportFilters(result.current[0], { q: 'typed' })));
    act(() => {
      window.history.replaceState(
        null,
        '',
        '/content?from=2026-08-01&toExclusive=2026-09-01&q=back',
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toMatchObject({ from: '2026-08-01', q: 'back' });
    rerender({ identity: 'p1:r2', initial: initialReportContext });
    expect(result.current[0]).toEqual(initialReportContext);
    rerender({ identity: 'p1:r2', initial: { ...initialReportContext, from: '2026-08-10' } });
    expect(result.current[0].from).toBe('2026-08-10');
  });
});

// Preserve regression coverage of the opt-in brand-filter capability.
brandBeforeEach(() => brandVi.stubEnv('NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED', 'true'));
brandAfterEach(() => brandVi.unstubAllEnvs());
