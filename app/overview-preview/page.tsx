import { notFound } from 'next/navigation';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { OverviewPreview } = await import('@overview-preview');
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === 'string') search.set(k, v);
  return <OverviewPreview search={search.toString()} />;
}
