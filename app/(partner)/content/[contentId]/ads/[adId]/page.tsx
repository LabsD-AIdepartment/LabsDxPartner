import { requirePartnerAccess } from '@/server/modules/access/requirePartnerAccess';
export default async function Page({
  params,
}: {
  params: Promise<{ contentId: string; adId: string }>;
}) {
  const { contentId, adId } = await params;
  return requirePartnerAccess(
    `/content/${encodeURIComponent(contentId)}/ads/${encodeURIComponent(adId)}`,
  );
}
