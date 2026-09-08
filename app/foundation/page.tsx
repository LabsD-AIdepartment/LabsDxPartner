import { notFound } from 'next/navigation';
export default async function FoundationPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { FoundationGallery } = await import('@foundation-gallery');
  return <FoundationGallery />;
}
