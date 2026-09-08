import { PublicFrame } from '@/features/login/PublicFrame';
import { AccessPage } from '@/features/login/AccessPage';
import { safeReturnTo, parseAccessReason } from '@/features/login/access';
export default async function AccessRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <PublicFrame>
      <AccessPage reason={parseAccessReason(params.reason)} next={safeReturnTo(params.next)} />
    </PublicFrame>
  );
}
