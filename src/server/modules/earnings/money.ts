import { Money, type MoneyValue } from '@/contracts/common';
export function minorOf(value: MoneyValue): bigint {
  return BigInt(Money.parse(value).minor);
}
export function thb(minor: bigint): MoneyValue {
  return { currency: 'THB', minor: minor.toString() };
}
