import { redirectPitchLegacy } from '@/server/platform/pitch-legacy';
import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirectPitchLegacy('/account-preview', await searchParams);
  if (!developmentPreviewsEnabled()) notFound();
  const values = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (typeof value === 'string') search.set(key, value);
  const { AccountPreview } = await import('@account-preview');
  return <AccountPreview search={search.toString()} />;
}
