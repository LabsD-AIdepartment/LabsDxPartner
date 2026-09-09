import { requirePartnerAccess } from '@/server/modules/access/requirePartnerAccess';
export default async function Page({ params }: { params: Promise<{ statementId: string }> }) {
  const { statementId } = await params;
  return requirePartnerAccess('/transactions/' + encodeURIComponent(statementId));
}
