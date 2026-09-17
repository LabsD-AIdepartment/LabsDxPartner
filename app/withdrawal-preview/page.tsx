import { redirectPitchLegacy } from '@/server/platform/pitch-legacy';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirectPitchLegacy('/withdrawal-preview', await searchParams);
  if (!developmentPreviewsEnabled()) notFound();
  const { WithdrawalPreview } = await import('@withdrawal-preview');
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === 'string') search.set(k, v);
  return <WithdrawalPreview search={search.toString()} />;
}
