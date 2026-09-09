import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireStaffAccess } from '@/server/modules/access/requireStaffAccess';
import { AccessFailure } from '@/server/modules/partners/access';
const mocks = vi.hoisted(() => ({ session: vi.fn(), binding: vi.fn(), runtime: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error('redirect:' + path);
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/server/modules/identity/runtime', () => ({ getIdentityRuntime: () => mocks.runtime() }));
beforeEach(() => {
  mocks.session.mockReset();
  mocks.binding.mockReset();
  mocks.runtime.mockReturnValue({
    assertBinding: mocks.binding,
    partners: { staffSession: mocks.session },
  });
});
describe('staff leaf authorization', () => {
  it('returns current staff proof without using browser role claims', async () => {
    const proof = { userId: 'staff', displayName: 'Staff', revision: '2' };
    mocks.session.mockResolvedValue(proof);
    expect(await requireStaffAccess()).toBe(proof);
    expect(mocks.binding).toHaveBeenCalledOnce();
  });
  it('sends unauthenticated staff to the concrete supported login destination', async () => {
    mocks.session.mockRejectedValue(new AccessFailure('unauthenticated'));
    await expect(requireStaffAccess()).rejects.toThrow('redirect:/login?next=%2Fops%2Faccess');
  });
  it('keeps valid nonstaff accounts out of operations without a login loop', async () => {
    mocks.session.mockRejectedValue(new AccessFailure('forbidden'));
    await expect(requireStaffAccess()).rejects.toThrow('redirect:/account');
  });
});
