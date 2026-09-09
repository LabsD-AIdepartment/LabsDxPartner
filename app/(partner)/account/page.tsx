import { requirePartnerAccess } from '@/server/modules/access/requirePartnerAccess';
export default function Page() {
  return requirePartnerAccess('/account');
}
