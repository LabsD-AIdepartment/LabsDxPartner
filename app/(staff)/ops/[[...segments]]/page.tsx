import { requireStaffAccess } from '@/server/modules/access/requireStaffAccess';
import { StaffAccessConsole } from '@/features/staff-access/StaffAccessConsole';
import { notFound, redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ segments?: string[] }> }) {
  const { segments = [] } = await params;
  const session = await requireStaffAccess();
  if (!segments.length) redirect('/ops/access');
  if (segments.length !== 1 || segments[0] !== 'access') notFound();
  return <StaffAccessConsole session={session} />;
}
