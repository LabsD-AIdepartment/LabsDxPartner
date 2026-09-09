'use client';
import { useEffect, useState } from 'react';
const key = 'labsd-synthetic-payment-f06';
/** Development only; never session authority or a product financial write. */
export function usePreviewPayment() {
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    try {
      setPaid(sessionStorage.getItem(key) === 'paid');
    } catch {}
  }, []);
  return [
    paid,
    (value: boolean) => {
      setPaid(value);
      try {
        sessionStorage.setItem(key, value ? 'paid' : 'unpaid');
      } catch {}
    },
  ] as const;
}
