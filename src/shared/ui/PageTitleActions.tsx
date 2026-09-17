'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The shell owns placement; the feature keeps ownership of its controls and state. */
export const PageTitleActionsTarget = createContext<HTMLElement | null | undefined>(undefined);

export function PageTitleActions({
  children,
  fallbackClassName,
}: {
  children: ReactNode;
  fallbackClassName?: string;
}) {
  const target = useContext(PageTitleActionsTarget);
  if (target === undefined) return <div className={fallbackClassName}>{children}</div>;
  return target ? createPortal(children, target) : null;
}
