'use client';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import { useApplicationPresentation } from '@/shared/routing/ApplicationPresentation';
export default function AppLink({ href, ...props }: ComponentProps<typeof Link>) {
  const { resolveHref } = useApplicationPresentation();
  return <Link {...props} href={typeof href === 'string' ? resolveHref(href) : href} />;
}
