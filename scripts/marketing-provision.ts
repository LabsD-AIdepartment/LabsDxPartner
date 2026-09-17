import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parseFacebookProfiles } from '../src/server/modules/marketing-ads/facebook/config';
import { createMarketingProvisioner } from '../src/server/modules/marketing-ads/provision';
import { ProvisionFailure } from '../src/server/modules/marketing-ads/provision-command';
import {
  readCredentialConfig,
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '../src/server/modules/identity/credential-auth';
import { parseShopVideoProfiles } from '../src/server/modules/marketing-ads/tiktok-shop/video-config';
import { createShopVideoProvisioner } from '../src/server/modules/marketing-ads/tiktok-shop/video-provision';
const requestId = randomUUID();
async function main() {
  let args = process.argv.slice(2);
  let platform: 'facebook' | 'tiktok' = 'facebook';
  if (args[0] === '--platform') {
    if (args[1] !== 'facebook' && args[1] !== 'tiktok') throw new ProvisionFailure('invalid-input');
    platform = args[1];
    args = args.slice(2);
  }
  const inspect =
    args[0] === '--inspect' &&
    (args.length === 1 || (args.length === 3 && args[1] === '--staff-after'));
  const apply =
    args.length === 4 &&
    args[1] === '--apply' &&
    args[2] === '--plan-hash' &&
    /^[a-f0-9]{64}$/.test(args[3]);
  const preview = args.length === 1 && !args[0].startsWith('--');
  if (!inspect && !apply && !preview) throw new ProvisionFailure('invalid-input');
  let command: unknown;
  if (!inspect) {
    const file = await open(args[0], 'r');
    try {
      if (!(await file.stat()).isFile()) throw new ProvisionFailure('invalid-input');
      const buffer = Buffer.alloc(32769);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
        if (!bytesRead) break;
        used += bytesRead;
      }
      if (used > 32768) throw new ProvisionFailure('invalid-input');
      try {
        command = JSON.parse(buffer.subarray(0, used).toString('utf8'));
      } catch {
        throw new ProvisionFailure('invalid-input');
      }
    } finally {
      await file.close();
    }
  }
  const config = readCredentialConfig(process.env);
  const profiles =
    platform === 'facebook' ? parseFacebookProfiles(process.env.LABSD_FACEBOOK_PROFILES) : null;
  const shopProfiles =
    platform === 'tiktok' ? parseShopVideoProfiles(process.env.LABSD_TIKTOK_VIDEO_PROFILES) : null;
  const sql = postgres(config.DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
  try {
    const assertBinding = async (tx: import('postgres').TransactionSql) => {
      const [row] =
        await tx`select namespace_digest,current_database() as database from portal_identity.binding where id=${CREDENTIAL_BINDING_ID} for share`;
      if (row?.namespace_digest !== credentialBindingDigest(config))
        throw new ProvisionFailure('identity-mismatch');
      const url = new URL(config.DATABASE_URL);
      return createHash('sha256')
        .update(
          JSON.stringify([
            row.namespace_digest,
            row.database,
            url.hostname,
            url.port,
            url.username,
          ]),
        )
        .digest('hex');
    };
    const service = profiles
      ? createMarketingProvisioner(sql, profiles, assertBinding)
      : createShopVideoProvisioner(sql, shopProfiles!, assertBinding);
    const result = inspect
      ? await service.inspect(args[2] ?? null)
      : apply
        ? await service.apply(command, args[3])
        : await service.preview(command);
    console.log(JSON.stringify({ requestId, ...result }));
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  // Never echo input files, environment values, driver errors or source configuration.
  console.error(
    JSON.stringify({
      requestId,
      state: 'failed',
      code: error instanceof ProvisionFailure ? error.code : 'unavailable',
    }),
  );
  process.exitCode = 1;
});
