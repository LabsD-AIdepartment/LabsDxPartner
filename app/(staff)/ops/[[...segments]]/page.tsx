import { requireStaffAccess } from '@/server/modules/access/requireStaffAccess';
export default function Page() {
  return requireStaffAccess();
}
