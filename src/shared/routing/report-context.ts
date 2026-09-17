import { partnerFilters } from '@/shared/config/partner-features';
import { QueryFilters, Id } from '@/contracts/common';
import type { FilterValue } from '@/shared/ui/FilterBar';
export type ReportContext = FilterValue & {
  q: string;
  cursor: string | null;
  history: (string | null)[];
  generation: string | null;
  origin: 'overview' | 'content';
};
export const initialReportContext: ReportContext = {
  from: '2026-07-01',
  toExclusive: '2026-09-01',
  brand: null,
  q: '',
  cursor: null,
  history: [],
  generation: null,
  origin: 'content',
};
export function readReportContext(params: URLSearchParams): ReportContext {
  let history: (string | null)[] = [];
  try {
    const raw: unknown = JSON.parse(params.get('history') ?? '[]');
    if (
      Array.isArray(raw) &&
      raw.length <= 100 &&
      raw.every((x) => x === null || (typeof x === 'string' && x.length <= 1000))
    )
      history = raw;
  } catch {
    /* An invalid cursor trail never becomes navigation code. */
  }
  const g = params.get('generation');
  return partnerFilters({
    from: params.get('from') ?? initialReportContext.from,
    toExclusive: params.get('toExclusive') ?? initialReportContext.toExclusive,
    brand: params.get('brand') || null,
    q: params.get('q') ?? '',
    cursor: params.get('cursor') || null,
    history,
    generation: g || null,
    origin: params.get('origin') === 'overview' ? 'overview' : 'content',
  });
}
export function reportSearch(c: ReportContext) {
  c = partnerFilters(c);
  const p = new URLSearchParams({ from: c.from, toExclusive: c.toExclusive, origin: c.origin });
  if (c.brand) p.set('brand', c.brand);
  if (c.q) p.set('q', c.q);
  if (c.cursor) p.set('cursor', c.cursor);
  if (c.history.length) p.set('history', JSON.stringify(c.history));
  if (c.generation) p.set('generation', c.generation);
  return p.toString();
}
// Report query fields owned by reportSearch. Stripped from a base path's existing query before the
// fresh report search is merged, so a stale filter never survives and a dev/base param never leaks
// into the product ReportContext (nor vice-versa).
const REPORT_FIELDS = [
  'from',
  'toExclusive',
  'origin',
  'brand',
  'q',
  'cursor',
  'history',
  'generation',
] as const;
/**
 * Merge the report search into `path`, preserving any NON-report base query params (e.g. a dev
 * `scenario`/`identity` prefix carries its own query) and a trailing `#hash`, while dropping stale
 * report fields. `path` may be a bare path, a path with a query, and/or a path with a hash.
 */
export function reportHref(path: string, c: ReportContext) {
  const hashAt = path.indexOf('#');
  const hash = hashAt >= 0 ? path.slice(hashAt) : '';
  const beforeHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = beforeHash.indexOf('?');
  const base = queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash;
  const merged = new URLSearchParams(queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '');
  for (const field of REPORT_FIELDS) merged.delete(field);
  for (const [key, value] of new URLSearchParams(reportSearch(c))) merged.append(key, value);
  const query = merged.toString();
  return `${base}${query ? '?' + query : ''}${hash}`;
}
/** Top-level navigation carries filters, never a detail generation or pagination cursor. */
export function reportNavigationHrefs(
  c: ReportContext,
  paths: { overview: string; content: string; transactions: string },
) {
  if (!validContentFilters(c)) return paths;
  const current = { ...c, generation: null, cursor: null, history: [] };
  const overview = reportHref(paths.overview, { ...current, q: '', origin: 'overview' });
  const content = reportHref(paths.content, { ...current, origin: 'content' });
  return {
    overview,
    content,
    transactions:
      reportHref(paths.transactions, current) +
      '&' +
      new URLSearchParams({ returnTo: c.origin === 'overview' ? overview : content }),
  };
}
export function validContentFilters(c: ReportContext) {
  c = partnerFilters(c);
  return (
    (c.generation === null || Id.safeParse(c.generation).success) &&
    QueryFilters.safeParse({
      from: c.from,
      toExclusive: c.toExclusive,
      brand: c.brand,
      q: c.q,
      cursor: c.cursor,
    }).success
  );
}
export function changeReportFilters(
  c: ReportContext,
  patch: Partial<FilterValue & { q: string }>,
): ReportContext {
  return partnerFilters({ ...c, ...patch, cursor: null, history: [], generation: null });
}
