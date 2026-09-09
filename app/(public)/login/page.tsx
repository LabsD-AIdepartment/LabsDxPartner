import { PublicFrame } from '@/features/login/PublicFrame';
import { LoginPage } from '@/features/login/LoginPage';
import { safeReturnTo } from '@/features/login/access';
export const dynamic = 'force-dynamic';
export default async function LoginRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <PublicFrame>
      <LoginPage next={safeReturnTo(params.next)} />
    </PublicFrame>
  );
}
