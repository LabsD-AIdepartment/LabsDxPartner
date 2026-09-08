const SCALE = 1_000_000n;
export function sumMinor(values: readonly bigint[]): bigint {
  return values.reduce((total, v) => total + v, 0n);
}
function validRate(rate: number) {
  if (!Number.isInteger(rate) || rate < 0 || rate > 1_000_000)
    throw new Error('Rate must be integer ppm within 0..1000000');
}
function rounded(n: bigint) {
  return n < 0n ? -((-n + SCALE / 2n) / SCALE) : (n + SCALE / 2n) / SCALE;
}
export function commission(base: bigint, ratePpm: number): bigint {
  validRate(ratePpm);
  return rounded(base * BigInt(ratePpm));
}
/** One agreement/rate/currency/calculation-period group; callers must group before calling. */
export function allocatePeriod(
  lines: readonly { id: string; base: bigint }[],
  ratePpm: number,
): Record<string, bigint> {
  validRate(ratePpm);
  if (new Set(lines.map((x) => x.id)).size !== lines.length || lines.some((x) => !x.id))
    throw new Error('Logical source IDs must be unique and nonempty');
  const rows = lines.map((line) => {
    const exact = line.base * BigInt(ratePpm);
    // Mathematical floor keeps every remainder nonnegative, including signed groups.
    const floor = exact >= 0n ? exact / SCALE : -((-exact + SCALE - 1n) / SCALE);
    return { ...line, exact, floor, remainder: exact - floor * SCALE };
  });
  const target = rounded(sumMinor(rows.map((x) => x.exact)));
  let left = target - sumMinor(rows.map((x) => x.floor));
  rows.sort((a, b) =>
    a.remainder === b.remainder
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  const allocated = rows.map((row) => {
    const amount = row.floor + (left > 0n ? 1n : 0n);
    if (left > 0n) left--;
    return [row.id, amount] as const;
  });
  if (left !== 0n) throw new Error('Invalid period allocation');
  return Object.fromEntries(allocated.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
export function cumulativeDeltas(
  previous: Readonly<Record<string, bigint>>,
  current: Readonly<Record<string, bigint>>,
): Record<string, bigint> {
  const ids = Object.keys(previous).sort();
  if (ids.length !== Object.keys(current).length || ids.some((id) => !Object.hasOwn(current, id)))
    throw new Error('Corrections must retain original group IDs, including zeroed rows');
  return Object.fromEntries(ids.map((id) => [id, current[id] - previous[id]]));
}
