import { PublicFrame } from '@/features/login/PublicFrame';
import { ResetPasswordPage } from '@/features/login/ResetPasswordPage';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <PublicFrame>
      <ResetPasswordPage />
    </PublicFrame>
  );
}
