import { notFound } from 'next/navigation';
export default async function Page() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { AccountPreview } = await import('@account-preview');
  return <AccountPreview />;
}
