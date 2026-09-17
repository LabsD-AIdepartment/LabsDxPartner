import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  if (!developmentPreviewsEnabled()) notFound();
  const { target } = await searchParams;
  const { AdRegistrationPreview } = await import('@marketing-ads-preview');
  return <AdRegistrationPreview initialTargetId={target} />;
}
