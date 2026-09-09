import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemberAccessForm } from '@/shared/access/MemberAccessForm';

const member = {
  id: 'member-one',
  userId: 'recipient-one',
  displayName: 'คุณดารา',
  status: 'active' as const,
  revision: '7',
  verifiedContactRef: 'verified-contact',
  capabilities: ['view_earnings' as const],
};
describe('shared member access form', () => {
  it('reviews an active capability edit against the exact recipient and revision', () => {
    const review = vi.fn();
    render(<MemberAccessForm partnerId="partner-one" member={member} onReview={review} />);
    fireEvent.click(screen.getByLabelText('คลิปและผลงาน'));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจการบันทึกสิทธิ์' }));
    expect(review).toHaveBeenCalledWith(
      {
        partnerId: 'partner-one',
        userId: 'recipient-one',
        expectedRevision: '7',
        status: 'active',
        verifiedContactRef: 'verified-contact',
        capabilities: ['view_content', 'view_earnings'],
      },
      'ปรับข้อมูลและสิทธิ์สมาชิก',
    );
  });
  it('distinguishes suspension from saving the current active status', () => {
    const review = vi.fn();
    render(<MemberAccessForm partnerId="partner-one" member={member} onReview={review} />);
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจการระงับสมาชิก' }));
    expect(review.mock.calls[0][0]).toMatchObject({ status: 'suspended', userId: member.userId });
  });
  it('rejects restoration without any viewing permission', () => {
    const review = vi.fn();
    render(
      <MemberAccessForm
        partnerId="partner-one"
        member={{ ...member, status: 'suspended', capabilities: [] }}
        onReview={review}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจการเปิดใช้งานสมาชิก' }));
    expect(review).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('อย่างน้อยหนึ่งรายการ');
    fireEvent.click(screen.getByLabelText('คลิปและผลงาน'));
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจการเปิดใช้งานสมาชิก' }));
    expect(review.mock.calls[0][0]).toMatchObject({
      status: 'active',
      capabilities: ['view_content'],
    });
  });
  it('explains historical pending accounts without adding an approval step to new invitations', () => {
    render(
      <MemberAccessForm
        partnerId="partner-one"
        member={{ ...member, status: 'pending' }}
        onReview={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/คำเชิญแบบใหม่เปิดใช้งานให้ผู้รับหลังตั้งบัญชีสำเร็จโดยตรง/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ตรวจการบันทึกสิทธิ์' })).not.toBeInTheDocument();
  });
});
