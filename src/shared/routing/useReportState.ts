'use client';
import { useApplicationPresentation } from './ApplicationPresentation';
import { useCallback, useEffect, useState } from 'react';
import {
  readReportContext,
  reportSearch,
  validContentFilters,
  type ReportContext,
} from './report-context';

/** One editable report scope for the page, its query and its navigation. */
export function useReportState(initial: ReportContext, identity: string, path: string) {
  const { resolveHref } = useApplicationPresentation();
  path = resolveHref(path);
  const key = JSON.stringify([identity, path, initial]);
  const [edited, setEdited] = useState<{ key: string; value: ReportContext } | null>(null);
  // A route or permission change cannot render the previous scope, even for one effect frame.
  const context = edited?.key === key ? edited.value : initial;
  const change = useCallback(
    (value: ReportContext) => {
      setEdited({ key, value });
      // Preserve Next's history state. Invalid date drafts remain editable without replacing the URL.
      if (window.location.pathname === path && validContentFilters(value))
        window.history.replaceState(window.history.state, '', path + '?' + reportSearch(value));
    },
    [key, path],
  );
  useEffect(() => {
    const restore = () => {
      if (window.location.pathname === path)
        setEdited({ key, value: readReportContext(new URLSearchParams(window.location.search)) });
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [key, path]);
  return [context, change] as const;
}
