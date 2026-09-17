/** Canonical navigation for the approved pitch composition; no external URLs are rewritten. */
export function pitchHref(href: string, depth = 0): string {
  if (!href.startsWith('/') || href.startsWith('//') || depth > 3) return href;
  const url = new URL(href, 'https://pitch.invalid');
  url.pathname = url.pathname
    .replace(/^\/(?:withdrawal|overview)-preview(?=\/|$)/, '/overview')
    .replace(/^\/content-preview(?:\/partner-demo\/[ab])?(?=\/|$)/, '/content')
    .replace(/^\/transactions-preview(?=\/|$)/, '/transactions')
    .replace(/^\/account-preview(?=\/|$)/, '/account');
  if (url.pathname === '/access-preview') return '/login';
  if (url.pathname.startsWith('/ops-preview')) return '/overview';
  const returned = url.searchParams.get('returnTo');
  if (returned) url.searchParams.set('returnTo', pitchHref(returned, depth + 1));
  for (const key of ['scenario', 'identity', 'devtools']) url.searchParams.delete(key);
  return url.pathname + url.search + url.hash;
}
export function pitchSearch(search: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (typeof value === 'string') params.set(key, value);
  params.delete('devtools');
  params.set('scenario', 'partner-demo');
  params.set('identity', 'a');
  if (!params.has('from')) params.set('from', '2026-07-01');
  if (!params.has('toExclusive')) params.set('toExclusive', '2026-09-01');
  return params.toString();
}
