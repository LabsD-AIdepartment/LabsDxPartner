import { authorizePitchRequest } from '@/server/platform/pitch-access';
import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { handleAuthorizedAdPerformanceRequest } from '../../../dev/ad-performance/handler';
export async function handleAdPerformanceRequest(request: Request): Promise<Response> {
  if (!pitchModeEnabled() || process.env.LABSD_HOSTED_DEMO_ARTIFACT !== '1' ||
      process.env.LABSD_AD_SNAPSHOT_DATABASE !== '1') return new Response(null, {status:404});
  const denied = await authorizePitchRequest(request);
  if (denied) return denied;
  return handleAuthorizedAdPerformanceRequest(request);
}
