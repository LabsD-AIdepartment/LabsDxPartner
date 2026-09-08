/** Bounded fixed-point projection for pixel geometry only, never monetary calculation. */
export function displayRatio(value: bigint, total: bigint) {
  return total === 0n ? 0 : Number((value * 10000n) / total) / 10000;
}
