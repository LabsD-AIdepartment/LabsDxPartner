import { requirePartnerAccess } from '@/server/modules/access/requirePartnerAccess';
export default async function Page({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params;
  return requirePartnerAccess('/content/' + encodeURIComponent(contentId));
}
