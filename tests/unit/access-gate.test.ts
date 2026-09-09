import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requirePartnerAccess } from '@/server/modules/access/requirePartnerAccess';
import { AccessFailure } from '@/server/modules/partners/access';
const mocked = vi.hoisted(() => ({ session: vi.fn(), binding: vi.fn(), runtime: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error('redirect:' + path);
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/server/modules/identity/runtime', () => ({
  getIdentityRuntime: () => mocked.runtime(),
}));
beforeEach(() => {
  mocked.session.mockReset();
  mocked.binding.mockReset();
  mocked.runtime.mockReturnValue({
    assertBinding: mocked.binding,
    partners: { session: mocked.session },
  });
});
describe('partner page gate', () => {
  it('returns verified sessions instead of redirecting valid logins', async () => {
    const session = {
      userId: 'verified',
      displayName: 'Partner',
      memberships: [],
      activePartnerId: null,
      access: 'pending',
    };
    mocked.session.mockResolvedValue(session);
    expect(await requirePartnerAccess('/overview')).toBe(session);
    expect(mocked.binding).toHaveBeenCalledOnce();
  });
  it('sends expired authentication to login while preserving the safe leaf destination', async () => {
    mocked.session.mockRejectedValue(new AccessFailure('unauthenticated'));
    await expect(requirePartnerAccess('/content/clip-one')).rejects.toThrow(
      'redirect:/login?next=%2Fcontent%2Fclip-one',
    );
  });
  it('does not misreport disabled or failed identity as wrong user credentials', async () => {
    mocked.runtime.mockReturnValue(null);
    await expect(requirePartnerAccess('/overview')).rejects.toThrow(
      'redirect:/access?reason=retry',
    );
    mocked.runtime.mockReturnValue({
      assertBinding: mocked.binding,
      partners: { session: mocked.session },
    });
    mocked.binding.mockRejectedValue(new Error('private database failure'));
    await expect(requirePartnerAccess('/overview')).rejects.toThrow(
      'redirect:/access?reason=retry',
    );
    expect(mocked.session).not.toHaveBeenCalled();
  });
});
