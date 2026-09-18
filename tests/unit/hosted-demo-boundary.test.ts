// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ authorize: vi.fn(), read: vi.fn() }));
vi.mock('@/server/platform/pitch-access', () => ({authorizePitchRequest: boundary.authorize}));
vi.mock('../../dev/ad-performance/handler', () => ({handleAuthorizedAdPerformanceRequest: boundary.read}));
import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { handleAdPerformanceRequest } from '@/server/hosted-demo/ad-performance';
import { handleDemoDatasetRequest } from '@/server/hosted-demo/dataset';
const request = () => new Request('https://partner.example/api/dev/ad-performance?identity=a&clip=all');
beforeEach(() => {
  vi.stubEnv('NODE_ENV','production'); vi.stubEnv('LABSD_HOSTED_DEMO_ARTIFACT','1');
  vi.stubEnv('LABSD_HOSTED_DEMO_ENABLED','1'); vi.stubEnv('LABSD_PRESENTATION_MODE','pitch');
  vi.stubEnv('LABSD_AD_SNAPSHOT_DATABASE','1');
  boundary.authorize.mockReset().mockResolvedValue(null);
  boundary.read.mockReset().mockResolvedValue(Response.json({connections:[]}));
});
afterEach(() => vi.unstubAllEnvs());
it('requires an explicit artifact and runtime opt-in independently', () => {
  expect(pitchModeEnabled()).toBe(true);
  vi.stubEnv('LABSD_HOSTED_DEMO_ARTIFACT','0'); expect(pitchModeEnabled()).toBe(false);
  vi.stubEnv('LABSD_HOSTED_DEMO_ARTIFACT','1'); vi.stubEnv('LABSD_HOSTED_DEMO_ENABLED','0'); expect(pitchModeEnabled()).toBe(false);
});
it.each([401,403,404])('does not read financial data when authorization returns %s', async status => {
  boundary.authorize.mockResolvedValue(new Response(null,{status}));
  expect((await handleAdPerformanceRequest(request())).status).toBe(status);
  expect((await handleDemoDatasetRequest(request())).status).toBe(status);
  expect(boundary.read).not.toHaveBeenCalled();
});
it('refuses hosted file/provider fallback when database reports are disabled', async () => {
  vi.stubEnv('LABSD_AD_SNAPSHOT_DATABASE','0');
  expect((await handleAdPerformanceRequest(request())).status).toBe(404);
  expect(boundary.read).not.toHaveBeenCalled();
});
it('uses the authenticated database projection for the hosted origin', async () => {
  expect((await handleAdPerformanceRequest(request())).status).toBe(200);
  expect(boundary.authorize).toHaveBeenCalledOnce(); expect(boundary.read).toHaveBeenCalledOnce();
});
it('fails closed on an unprovisioned sample dataset rather than returning invented balances', async () => {
  vi.stubEnv('LABSD_HOSTED_DATA_DIR','');
  expect((await handleDemoDatasetRequest(request())).status).toBe(503);
});

it.each(['LABSD_IDENTITY_ENABLED','LABSD_AD_SNAPSHOT_DATABASE','LABSD_AD_SNAPSHOT_ENABLED'])(
  'startup refuses missing required %s before any file/database access', async flag => {
    const {validateHostedDemoEnvironment} = await import('../../scripts/validate-hosted-demo');
    const env={NODE_ENV:'production' as const,LABSD_IDENTITY_ENABLED:'1',LABSD_AD_SNAPSHOT_DATABASE:'1',LABSD_AD_SNAPSHOT_ENABLED:'1', [flag]:'0'};
    expect(()=>validateHostedDemoEnvironment(env)).toThrow();
  },
);
