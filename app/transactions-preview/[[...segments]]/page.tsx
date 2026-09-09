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
  if (segments.length > 1 || (segments[0] && !/^[a-zA-Z0-9_-]+$/.test(segments[0]))) notFound();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === 'string') search.set(k, v);
  const { TransactionsPreview } = await import('@transactions-preview');
  return <TransactionsPreview segments={segments} search={search.toString()} />;
}
