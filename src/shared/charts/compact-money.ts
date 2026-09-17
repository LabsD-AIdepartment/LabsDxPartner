/** Chart-only approximation; exact monetary values remain in titles and detail views. */
export function compactMoney(minor: string): string {
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const units = [
    { scale: 100000000000n, suffix: 'b' },
    { scale: 100000000n, suffix: 'm' },
    { scale: 100000n, suffix: 'k' },
  ];
  // Promote across a unit boundary after rounding, e.g. 999,999.99 -> 1m.
  const unit = units.find(({ scale }) => absolute >= scale - scale / 20000n);
  const sign = value < 0n ? '-' : '';
  if (!unit) {
    const fraction = (absolute % 100n).toString().padStart(2, '0').replace(/0+$/, '');
    return `${sign}${absolute / 100n}${fraction ? '.' + fraction : ''}`;
  }
  const tenths = (absolute * 10n + unit.scale / 2n) / unit.scale;
  return `${sign}${tenths / 10n}${tenths % 10n ? '.' + (tenths % 10n) : ''}${unit.suffix}`;
}
