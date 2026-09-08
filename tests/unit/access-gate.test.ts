import { describe, it, expect, vi } from 'vitest';
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
import { requirePartnerAccess } from '@/server/modules/access/requirePartnerAccess';
describe('pre-auth partner boundary', () => {
  it.each(['/overview', '/content', '/transactions'])(
    'always denies %s and preserves destination',
    (path) => {
      expect(() => requirePartnerAccess(path)).toThrow(
        `REDIRECT:/login?next=${encodeURIComponent(path)}`,
      );
    },
  );
});
