type IdentityHost = {
  assertBinding: () => Promise<void>;
  handle: (request: Request) => Promise<Response>;
};
/** Preserve the original request and every native Set-Cookie header. */
export async function handleIdentityRequest(request: Request, runtime: () => IdentityHost | null) {
  try {
    const identity = runtime();
    if (!identity) throw new Error('Identity disabled');
    await identity.assertBinding();
    const response = await identity.handle(request);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    return Response.json(
      { code: 'IDENTITY_UNAVAILABLE', retryable: true },
      {
        status: 503,
        headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
      },
    );
  }
}
