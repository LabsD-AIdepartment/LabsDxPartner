'use client';
import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { observePageMotion } from './page-motion';
import { DATA_ENTRANCE_EVENT } from './useDataEntrance';

/** A route visit gets a fresh animation cycle; the actual page and form state stay mounted. */
export function PageMotion() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    window.dispatchEvent(new Event(DATA_ENTRANCE_EVENT));
    return observePageMotion(document.body);
  }, [pathname, search]);
  return null;
}
