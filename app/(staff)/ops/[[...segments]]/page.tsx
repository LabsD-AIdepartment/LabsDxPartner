import { requireStaffAccess } from '@/server/modules/access/requireStaffAccess';
import { StaffFinanceConsole } from '@/features/staff-finance/StaffFinanceConsole';
import { StaffAccessConsole } from '@/features/staff-access/StaffAccessConsole';
import { notFound, redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  if (segments.length === 1 && segments[0] === 'periods') {
    const session = await requireStaffAccess('publish_statements', '/ops/periods');
    return <StaffFinanceConsole session={session} />;
  }
  const session = await requireStaffAccess();
  if (!segments.length) redirect('/ops/access');
  if (segments.length !== 1 || segments[0] !== 'access') notFound();
  return <StaffAccessConsole session={session} />;
}
