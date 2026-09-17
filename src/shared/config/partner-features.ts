/** Partner catalogue controls are opt-in. Keep the flag identical on server and client. */
export function partnerBrandFilterEnabled() {
  return process.env.NEXT_PUBLIC_PARTNER_BRAND_FILTER_ENABLED === 'true';
}
export function partnerFilters<T extends { brand: string | null }>(value: T): T {
  return partnerBrandFilterEnabled() || value.brand === null
    ? value
    : {
        ...value,
        brand: null,
        ...('cursor' in value ? { cursor: null, history: [], generation: null } : {}),
      };
}
