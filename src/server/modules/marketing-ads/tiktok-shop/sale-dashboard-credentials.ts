import { z } from 'zod';
import { Id } from '@/contracts/common';
import { SourceReadError } from '../source-error';
import { parseShopVideoProfiles, type VideoProfile } from './video-config';
import {
  abortable,
  ShopVideoCredentialSchema,
  type VideoTransportDependencies,
} from './video-transport';

const Binding = z.strictObject({
  sourceConnectionRef: Id,
  connectedAccountId: z.number().int().positive().max(2147483647),
  credentialId: z.number().int().positive().max(2147483647),
});
export type SaleDashboardBinding = z.infer<typeof Binding>;

/** Source-service ports, never Portal SQL or a remote token-export endpoint. */
export type SaleDashboardCredentialPorts = {
  query: (query: {
    text: string;
    values: [number, number, string];
    query_timeout: number;
  }) => Promise<{ rows: unknown[] }>;
  decryptToken: (encrypted: Buffer) => string;
  now?: () => number;
};

// One statement pins app credentials, token and cipher to the same account binding.
// Explicit public schema matches Sale Dashboard's integration schema, not Portal tables.
const SNAPSHOT = `SELECT a.external_account_id AS "shopId", a.currency, a.timezone,
  c.access_token_enc AS "accessTokenEnc", c.app_key_enc AS "appKeyEnc",
  c.app_secret_enc AS "appSecretEnc", c.expires_at AS "expiresAt",
  c.scopes ->> 'shop_cipher' AS "shopCipher"
FROM public.connected_accounts a
JOIN public.provider_credentials c ON c.id = a.credential_id
JOIN public.providers p ON p.id = a.provider_id
WHERE a.id = $1 AND c.id = $2 AND a.external_account_id = $3
  AND a.provider_id = 'tiktok' AND c.provider_id = 'tiktok'
  AND a.status = 'active' AND c.status = 'active' AND p.status = 'active'
LIMIT 2`;
const Encrypted = z.instanceof(Buffer).refine((value) => value.length > 0 && value.length <= 32768);
const Snapshot = z.object({
  shopId: z.string(),
  currency: z.string(),
  timezone: z.string(),
  accessTokenEnc: Encrypted,
  appKeyEnc: Encrypted,
  appSecretEnc: Encrypted,
  expiresAt: z.date(),
  shopCipher: z.string().min(1).max(8192),
});

/** Install only inside Sale Dashboard. No DB reads at construction, no caching,
 * no refresh, no fallback to another shop or environment credentials.
 * The source token manager owns renewal; scheduler wiring is verified at installation. */
export function createSaleDashboardVideoCredentialResolver(
  rawProfiles: readonly VideoProfile[],
  rawBindings: readonly SaleDashboardBinding[],
  ports: SaleDashboardCredentialPorts,
): VideoTransportDependencies['credential'] {
  const profiles = parseShopVideoProfiles(JSON.stringify(rawProfiles));
  const parsed = z.array(Binding).min(1).max(100).safeParse(rawBindings);
  if (!parsed.success) throw new Error('Invalid source credential bindings');
  const bindings = parsed.data;
  if (
    bindings.length !== profiles.length ||
    new Set(bindings.map((b) => b.sourceConnectionRef)).size !== bindings.length ||
    new Set(bindings.map((b) => b.connectedAccountId)).size !== bindings.length ||
    bindings.some((b) => !profiles.some((p) => p.sourceConnectionRef === b.sourceConnectionRef))
  )
    throw new Error('Invalid source credential bindings');
  const configured = new Map(
    profiles.map((profile) => [
      profile.connectionId,
      {
        profile,
        binding: bindings.find((b) => b.sourceConnectionRef === profile.sourceConnectionRef)!,
      },
    ]),
  );
  return async (connectionId, signal) => {
    signal.throwIfAborted();
    const selected = configured.get(connectionId);
    if (!selected) throw new SourceReadError('access');
    const { profile, binding } = selected;
    // Abort alone cannot cancel every driver's in-flight SQL; require driver query timeout too.
    let result: { rows: unknown[] };
    try {
      result = await abortable(
        ports.query({
          text: SNAPSHOT,
          values: [binding.connectedAccountId, binding.credentialId, profile.shopId],
          query_timeout: 5000,
        }),
        signal,
      );
    } catch {
      signal.throwIfAborted();
      throw new SourceReadError('temporary');
    }
    signal.throwIfAborted();
    if (result.rows.length !== 1) throw new SourceReadError('access');
    const snapshot = Snapshot.safeParse(result.rows[0]);
    if (!snapshot.success) throw new SourceReadError('access');
    const row = snapshot.data;
    if (
      row.shopId !== profile.shopId ||
      row.currency !== profile.currency ||
      row.timezone !== profile.timezone ||
      row.expiresAt.getTime() <= (ports.now ?? Date.now)() + 20000
    )
      throw new SourceReadError('access');
    try {
      // Never pass Zod/decryption errors (which may carry values) across the owner boundary.
      const credential = ShopVideoCredentialSchema.safeParse({
        shopId: row.shopId,
        shopCipher: row.shopCipher,
        appKey: ports.decryptToken(row.appKeyEnc),
        appSecret: ports.decryptToken(row.appSecretEnc),
        accessToken: ports.decryptToken(row.accessTokenEnc),
      });
      if (!credential.success) throw new SourceReadError('access');
      signal.throwIfAborted();
      return credential.data;
    } catch {
      signal.throwIfAborted();
      throw new SourceReadError('access');
    }
  };
}
