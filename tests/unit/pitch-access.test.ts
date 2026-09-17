import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionValue } from '@/contracts/session';
const sessionRead = vi.hoisted(() => vi.fn());
vi.mock('@/server/modules/identity/runtime', () => ({ getIdentityRuntime: () => ({ assertBinding: async () => {}, partners: { session: sessionRead } }) }));
import { authorizePitchRequest } from '@/server/platform/pitch-access';
import { canUsePitch, pitchModeEnabled } from '@/server/platform/pitch-mode';
const session: SessionValue = { userId: 'real-user', displayName: 'Partner', activePartnerId: 'real-partner', access: 'active', memberships: [{partnerId: 'real-partner', partnerName: 'Partner', permissionRevision: '1', capabilities: ['view_earnings','view_content','view_statements','view_ad_spend']}] };
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('LABSD_PRESENTATION_MODE', 'pitch');
  vi.stubEnv('LABSD_PITCH_USER_ID', 'real-user'); vi.stubEnv('LABSD_PITCH_PARTNER_ID', 'real-partner');
  sessionRead.mockResolvedValue(structuredClone(session));
});
afterEach(() => vi.unstubAllEnvs());
const request = (identity = 'a') => new Request(`https://127.0.0.1:4443/api/dev/demo-dataset?identity=${identity}`);
describe('authenticated pitch boundary', () => {
  it('requires explicit local mode and keeps production fixtures disabled', () => {
    expect(pitchModeEnabled()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production'); expect(pitchModeEnabled()).toBe(false); expect(canUsePitch(session)).toBe(false);
  });
  it('rejects anonymous direct dataset and media reads', async () => {
    sessionRead.mockRejectedValue(new Error('unauthenticated'));
    expect((await authorizePitchRequest(request()))?.status).toBe(401);
    expect((await authorizePitchRequest(request(), false))?.status).toBe(401);
  });
  it('allows only the configured real user and partner', async () => {
    expect(await authorizePitchRequest(request())).toBeNull();
    sessionRead.mockResolvedValue({...session, userId:'other-user'});
    expect((await authorizePitchRequest(request()))?.status).toBe(403);
    sessionRead.mockResolvedValue({...session, activePartnerId:'other-partner'});
    expect((await authorizePitchRequest(request()))?.status).toBe(403);
  });
  it('rejects revoked capability, suspension, and forged sample identity', async () => {
    expect((await authorizePitchRequest(request('b')))?.status).toBe(404);
    sessionRead.mockResolvedValue({...session, access:'suspended'});
    expect((await authorizePitchRequest(request()))?.status).toBe(403);
    sessionRead.mockResolvedValue({...session, memberships:[{...session.memberships[0],capabilities:['view_earnings']}]});
    expect((await authorizePitchRequest(request()))?.status).toBe(403);
  });
});
