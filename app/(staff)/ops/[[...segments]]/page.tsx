import { requireStaffAccess } from '@/server/modules/access/requireStaffAccess';
import { StaffFinanceConsole } from '@/features/staff-finance/StaffFinanceConsole';
import { statementPublicationEnabled } from '@/server/modules/statements/activation';
import { StaffAccessConsole } from '@/features/staff-access/StaffAccessConsole';
import { StaffMarketingConsole } from '@/features/marketing-ads/StaffMarketingConsole';
import { notFound, redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  if (segments.length === 1 && segments[0] === 'ads') {
    if (process.env.LABSD_MARKETING_ENABLED !== '1') notFound();
    const session = await requireStaffAccess('manage_partners', '/ops/ads');
    return (
      <StaffMarketingConsole
        session={session}
        shopVideoEnabled={process.env.LABSD_TIKTOK_VIDEO_ENABLED === '1'}
      />
    );
  }
  if (segments.length === 1 && segments[0] === 'periods') {
    const session = await requireStaffAccess('publish_statements', '/ops/periods');
    return (
      <StaffFinanceConsole
        session={session}
        publicationEnabled={statementPublicationEnabled(process.env)}
        marketingEnabled={process.env.LABSD_MARKETING_ENABLED === '1'}
      />
    );
  }
  const session = await requireStaffAccess();
  if (!segments.length) redirect('/ops/access');
  if (segments.length !== 1 || segments[0] !== 'access') notFound();
  return (
    <StaffAccessConsole
      session={session}
      accountProfileEnabled={process.env.LABSD_ACCOUNT_PROFILE_ENABLED === '1'}
      marketingEnabled={process.env.LABSD_MARKETING_ENABLED === '1'}
    />
  );
}
