'use client';
import { createContext, useContext, type ReactNode } from 'react';
export type ApplicationPresentation = {
  resolveHref: (href: string) => string;
  accountMenu?: ReactNode;
  footerNote?: ReactNode;
  sampleData?: boolean;
};
const defaultPresentation: ApplicationPresentation = { resolveHref: (href) => href };
export const ApplicationPresentationContext = createContext(defaultPresentation);
export const useApplicationPresentation = () => useContext(ApplicationPresentationContext);
