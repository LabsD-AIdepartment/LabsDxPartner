import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function PreviewRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!developmentPreviewsEnabled()) notFound();
  const { AccessPreview } = await import('@access-preview');
  const params = await searchParams;
  const active =
    params.screen === 'content' || params.screen === 'transactions' ? params.screen : 'overview';
  return <AccessPreview active={active} initialActive={params.state === 'active'} />;
}
