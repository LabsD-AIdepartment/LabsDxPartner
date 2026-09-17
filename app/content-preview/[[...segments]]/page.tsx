import { redirectPitchLegacy } from '@/server/platform/pitch-legacy';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ segments?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirectPitchLegacy('/content-preview' + '/' + ((await params).segments ?? []).join('/'), await searchParams);
  if (!developmentPreviewsEnabled()) notFound();
  const { segments = [] } = await params;
  const contentSegments =
    segments[0] === 'partner-demo' && ['a', 'b'].includes(segments[1])
      ? segments.slice(2)
      : segments;
  if (segments[0] === 'partner-demo' && contentSegments === segments) notFound();
  if (!(
    contentSegments.length === 0 ||
    (contentSegments.length === 1 && /^[a-zA-Z0-9_-]+$/.test(contentSegments[0])) ||
    (contentSegments.length === 3 &&
      contentSegments[1] === 'ads' &&
      [contentSegments[0], contentSegments[2]].every((x) => /^[a-zA-Z0-9_-]+$/.test(x)))
  ))
    notFound();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === 'string') search.set(k, v);
  const { ContentPreview } = await import('@content-preview');
  return <ContentPreview segments={segments} search={search.toString()} />;
}
