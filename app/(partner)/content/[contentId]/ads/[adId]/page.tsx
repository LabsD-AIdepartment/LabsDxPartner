import { renderPartnerPage } from '@/server/modules/access/renderPartnerPage';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ contentId: string; adId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { contentId, adId } = await params;
  return renderPartnerPage(
    '/content/' + encodeURIComponent(contentId) + '/ads/' + encodeURIComponent(adId),
    { kind: 'ad', contentId, adId },
    await searchParams,
  );
}
