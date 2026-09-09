import { notFound } from 'next/navigation';
export default async function Page({ params }: { params: Promise<{ segments?: string[] }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { segments = [] } = await params;
  const view = segments[0] ?? 'partners';
  if (segments.length > 1 || (view !== 'partners' && view !== 'imports' && view !== 'periods'))
    notFound();
  const { OperationsPreview } = await import('@operations-preview');
  return <OperationsPreview view={view} />;
}
