import { renderPartnerPage } from '@/server/modules/access/renderPartnerPage';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPartnerPage('/overview', { kind: 'overview' }, await searchParams);
}
