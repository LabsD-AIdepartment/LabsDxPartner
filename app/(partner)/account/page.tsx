import { renderPartnerPage } from '@/server/modules/access/renderPartnerPage';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return renderPartnerPage('/account', { kind: 'account' }, await searchParams);
}
