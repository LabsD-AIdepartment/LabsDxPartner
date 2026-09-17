import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!developmentPreviewsEnabled()) notFound();
  const { segments = [] } = await params;
  const view = segments[0] ?? 'partners';
  if (
    segments.length > 1 ||
    (view !== 'partners' && view !== 'imports' && view !== 'periods' && view !== 'requests')
  )
    notFound();
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (typeof value === 'string') search.set(key, value);
  const { OperationsPreview } = await import('@operations-preview');
  return <OperationsPreview view={view} search={search.toString()} />;
}
