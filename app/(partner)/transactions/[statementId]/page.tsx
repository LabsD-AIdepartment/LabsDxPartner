import { renderPartnerPage } from '@/server/modules/access/renderPartnerPage';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ statementId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { statementId } = await params;
  return renderPartnerPage(
    '/transactions/' + encodeURIComponent(statementId),
    { kind: 'statement', statementId },
    await searchParams,
  );
}
