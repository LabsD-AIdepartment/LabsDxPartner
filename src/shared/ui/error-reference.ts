/** A framework digest groups failures; this is not an identity or a unique request ID. */
export function errorReference(digest: unknown): string | null {
  if (typeof digest !== 'string' || !/^\d{1,10}(?:@E\d{1,10})?$/.test(digest)) return null;
  // Project a bounded opaque label instead of rendering the raw error property.
  let hash = 2166136261;
  for (const character of digest) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return 'E-' + (hash >>> 0).toString(16).padStart(8, '0');
}
