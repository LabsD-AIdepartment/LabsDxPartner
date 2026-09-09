import { MemberAccessForm } from '@/shared/access/MemberAccessForm';
import type { OpsValue, DraftCommand } from './model';
export function MemberEditor({
  partnerId,
  member,
  onReview,
}: {
  partnerId: string;
  member: OpsValue['partners']['items'][number]['members'][number];
  onReview: (draft: DraftCommand, label: string) => void;
}) {
  return (
    <MemberAccessForm
      partnerId={partnerId}
      member={member}
      onReview={(draft, label) => onReview({ action: 'membership', ...draft }, label)}
    />
  );
}
