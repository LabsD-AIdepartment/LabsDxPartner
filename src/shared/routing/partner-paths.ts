/** Restrict return paths to known application destinations; reject encoded routing ambiguity. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || /[%\\?#\s\u0000-\u001f]/u.test(value))
    return '/overview';
  return /^\/(?:overview|content(?:\/[A-Za-z0-9_-]+(?:\/ads\/[A-Za-z0-9_-]+)?)?|transactions(?:\/[A-Za-z0-9_-]+)?|account|ops\/(?:access|periods|ads))\/?$/.test(
    value,
  )
    ? value
    : '/overview';
}
export function loginHref(next: unknown) {
  return `/login?next=${encodeURIComponent(safeReturnTo(next))}`;
}
