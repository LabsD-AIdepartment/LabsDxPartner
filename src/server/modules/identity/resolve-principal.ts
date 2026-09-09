export type Principal = { userId: string; sessionId: string };
export type ResolvePrincipal = (headers: Headers) => Promise<Principal | null>;

/** Only maintained-library verified sessions may enter authorization services. */
export function principalResolver(
  auth: {
    api: {
      getSession(input: {
        headers: Headers;
      }): Promise<{ user: { id: string }; session: { id: string } } | null>;
    };
  },
  assertBinding: () => Promise<void>,
): ResolvePrincipal {
  return async (headers) => {
    await assertBinding();
    const result = await auth.api.getSession({ headers });
    return result ? { userId: result.user.id, sessionId: result.session.id } : null;
  };
}
