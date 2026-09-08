import { notFound } from 'next/navigation';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { segments = [] } = await params;
  if (!(
    segments.length === 0 ||
    (segments.length === 1 && /^[a-zA-Z0-9_-]+$/.test(segments[0])) ||
    (segments.length === 3 &&
      segments[1] === 'ads' &&
      [segments[0], segments[2]].every((x) => /^[a-zA-Z0-9_-]+$/.test(x)))
  ))
    notFound();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === 'string') search.set(k, v);
  const { ContentPreview } = await import('@content-preview');
  return <ContentPreview segments={segments} search={search.toString()} />;
}
