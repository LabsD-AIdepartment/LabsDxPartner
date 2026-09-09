import { renderPartnerPage } from '@/server/modules/access/renderPartnerPage';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ contentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contentId } = await params;
  return renderPartnerPage(
    '/content/' + encodeURIComponent(contentId),
    { kind: 'clip', contentId },
    await searchParams,
  );
}
