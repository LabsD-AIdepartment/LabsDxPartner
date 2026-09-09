import { PublicFrame } from '@/features/login/PublicFrame';
import { InvitePage } from '@/features/login/InvitePage';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <PublicFrame>
      <InvitePage />
    </PublicFrame>
  );
}
