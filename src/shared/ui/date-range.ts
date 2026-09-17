const DAY = 86_400_000;
export function dateNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}
export function addDays(value: string, days: number): string {
  const timestamp = dateNumber(value);
  if (timestamp === null) return '';
  const shifted = new Date(timestamp + days * DAY).toISOString().slice(0, 10);
  return /^\d{4}-/.test(shifted) ? shifted : '';
}
export function validDateRange(from: string, inclusiveEnd: string): boolean {
  const a = dateNumber(from),
    b = dateNumber(inclusiveEnd);
  return a !== null && b !== null && b >= a && b - a < 366 * DAY && !!addDays(inclusiveEnd, 1);
}
export function monthDays(month: string): (string | null)[] {
  const first = dateNumber(`${month}-01`);
  if (first === null) return [];
  const start = new Date(first).getUTCDay();
  const days: (string | null)[] = Array(start).fill(null);
  for (let i = 0; i < 31; i++) {
    const date = addDays(`${month}-01`, i);
    if (date.slice(0, 7) !== month) break;
    days.push(date);
  }
  return days;
}
export function shiftMonth(month: string, step: number) {
  const first = dateNumber(`${month}-01`);
  if (first === null) return month;
  const date = new Date(first);
  date.setUTCMonth(date.getUTCMonth() + step);
  const result = date.toISOString().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(result) ? result : month;
}
