import { notFound } from 'next/navigation';
export default async function PreviewRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { AccessPreview } = await import('@access-preview');
  const params = await searchParams;
  const active =
    params.screen === 'content' || params.screen === 'transactions' ? params.screen : 'overview';
  return <AccessPreview active={active} initialActive={params.state === 'active'} />;
}
