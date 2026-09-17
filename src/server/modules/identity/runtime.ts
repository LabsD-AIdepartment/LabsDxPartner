import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authSchema, binding } from '../../../../db/schema/identity';
import {
  createCredentialIdentity,
  readCredentialConfig,
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from './credential-auth';
import { credentialSessionHandler } from './credential-session';
import { createAccessHttp } from '@/server/http/access';
import { principalResolver } from './resolve-principal';
import { createPartnerAccess } from '../partners/access';
import { createPartnerSessionHttp } from '@/server/http/partner-session';
import { createConfiguredMarketingProviders } from '../marketing-ads/composition';
import { createMarketingRegistration } from '../marketing-ads/registration';
import { createMarketingConnections } from '../marketing-ads/connections';
import { createFacebookAccountVerifier } from '../marketing-ads/facebook/verify-account';
import { createReadinessProbe } from '@/server/platform/health/readiness';
import { checkIdentityReadiness } from './readiness';

type Runtime = {
  ready: () => Promise<boolean>;
  auth: ReturnType<typeof createCredentialIdentity>;
  assertBinding: () => Promise<void>;
  handle: (request: Request) => Promise<Response>;
  access: (request: Request) => Promise<Response>;
  partners: ReturnType<typeof createPartnerAccess>;
  partnerSession: (request: Request) => Promise<Response>;
  marketing: () => ReturnType<typeof createMarketingRegistration>;
  marketingConnections: () => ReturnType<typeof createMarketingConnections>;
};
let current: Runtime | undefined;
export function getIdentityRuntime(): Runtime | null {
  if (process.env.LABSD_IDENTITY_ENABLED !== '1') return null;
  if (current) return current;
  const config = readCredentialConfig(process.env);
  const sql = postgres(config.DATABASE_URL, { max: 10, idle_timeout: 20, connect_timeout: 5 });
  const db = drizzle(sql);
  const auth = createCredentialIdentity(
    config,
    drizzleAdapter(db, { provider: 'pg', schema: authSchema, transaction: true }),
  );
  const assertBinding = async () => {
    const rows = await db
      .select({ digest: binding.namespaceDigest })
      .from(binding)
      .where(eq(binding.id, CREDENTIAL_BINDING_ID))
      .limit(1);
    if (rows[0]?.digest !== credentialBindingDigest(config))
      throw new Error('Identity namespace binding unavailable');
  };
  const partners = createPartnerAccess(sql, principalResolver(auth, assertBinding));
  current = {
    ready: createReadinessProbe(() => checkIdentityReadiness(sql, credentialBindingDigest(config))),
    auth,
    assertBinding,
    handle: credentialSessionHandler(sql, config, auth),
    access: createAccessHttp(sql, config, principalResolver(auth, assertBinding), assertBinding),
    partners,
    partnerSession: createPartnerSessionHttp(partners, config.BETTER_AUTH_URL),
    marketingConnections: () =>
      createMarketingConnections(
        partners,
        createFacebookAccountVerifier(sql, process.env, assertBinding),
      ),
    marketing: () =>
      createMarketingRegistration(
        partners,
        createConfiguredMarketingProviders(sql, process.env, assertBinding).providers,
      ),
  };
  return current;
}
