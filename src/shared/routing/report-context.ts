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
  return {
    from: params.get('from') ?? initialReportContext.from,
    toExclusive: params.get('toExclusive') ?? initialReportContext.toExclusive,
    brand: params.get('brand') || null,
    q: params.get('q') ?? '',
    cursor: params.get('cursor') || null,
    history,
    generation: g || null,
    origin: params.get('origin') === 'overview' ? 'overview' : 'content',
  };
}
export function reportSearch(c: ReportContext) {
  const p = new URLSearchParams({ from: c.from, toExclusive: c.toExclusive, origin: c.origin });
  if (c.brand) p.set('brand', c.brand);
  if (c.q) p.set('q', c.q);
  if (c.cursor) p.set('cursor', c.cursor);
  if (c.history.length) p.set('history', JSON.stringify(c.history));
  if (c.generation) p.set('generation', c.generation);
  return p.toString();
}
export function reportHref(path: string, c: ReportContext) {
  return `${path}?${reportSearch(c)}`;
}
export function validContentFilters(c: ReportContext) {
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
  return { ...c, ...patch, cursor: null, history: [], generation: null };
}
