import { Minor } from '@/contracts/common';
/** Formatting is exact; charts may project bounded display values but never financial totals. */
export function formatMinor(value: string, omitZeroFraction = false): string {
  const minor = BigInt(Minor.parse(value));
  const absolute = minor < 0n ? -minor : minor;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${minor < 0n ? '-' : ''}฿${whole}${omitZeroFraction && fraction === '00' ? '' : '.' + fraction}`;
}
