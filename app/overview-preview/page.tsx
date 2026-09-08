import { notFound } from 'next/navigation';
export default async function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { OverviewPreview } = await import('@overview-preview');
  return <OverviewPreview />;
}
