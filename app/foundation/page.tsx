import { developmentPreviewsEnabled } from '@/server/platform/development-previews';
import { notFound } from 'next/navigation';
export default async function FoundationPage() {
  if (!developmentPreviewsEnabled()) notFound();
  const { FoundationGallery } = await import('@foundation-gallery');
  return <FoundationGallery />;
}
