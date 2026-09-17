import { getIdentityRuntime } from '@/server/modules/identity/runtime';
import { readPartnerCookie, selectSessionPartner } from '@/server/modules/access/partner-session';
import { canUsePitch } from './pitch-mode';
export async function authorizePitchRequest(
  request: Request,
  requireIdentity = true,
): Promise<Response | null> {
  try {
    const runtime = getIdentityRuntime();
    if (!runtime) throw new Error('Identity unavailable');
    await runtime.assertBinding();
    const session = selectSessionPartner(
      await runtime.partners.session(request.headers),
      readPartnerCookie(request.headers),
    );
    if (!canUsePitch(session)) return new Response(null, { status: 403 });
    if (requireIdentity && new URL(request.url).searchParams.get('identity') !== 'a')
      return new Response(null, { status: 404 });
    return null;
  } catch {
    return new Response(null, { status: 401 });
  }
}
