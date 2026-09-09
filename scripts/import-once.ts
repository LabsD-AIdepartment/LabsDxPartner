import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import {
  createReviewedFiles,
  ReviewedFileFailure,
} from '../src/server/adapters/reviewed-files/repository';
import {
  createReviewedFileImporter,
  ReviewedImportCommand,
} from '../src/server/modules/imports/from-reviewed-file';
import { ImportFailure } from '../src/server/modules/imports/run';
import { AccessFailure } from '../src/server/modules/partners/access';
import {
  readCredentialConfig,
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '../src/server/modules/identity/credential-auth';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--synthetic') {
    await (await import('./import-synthetic')).importSynthetic();
    return;
  }
  const command: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const name =
      args[i] === '--approval-id'
        ? 'approvalId'
        : args[i] === '--idempotency-key'
          ? 'idempotencyKey'
          : null;
    if (!name || !args[i + 1] || command[name]) throw new AccessFailure('invalid_input');
    command[name] = args[i + 1];
  }
  const parsed = ReviewedImportCommand.safeParse(command);
  if (!parsed.success) throw new AccessFailure('invalid_input');
  if (process.env.LABSD_IMPORT_ENABLED !== '1') throw new AccessFailure('forbidden');
  const config = readCredentialConfig(process.env);
  const directory = process.env.LABSD_REVIEW_DIRECTORY;
  if (!directory) throw new ReviewedFileFailure('unavailable');
  const files = createReviewedFiles(directory);
  // Separate, bounded worker pool. No web runtime singleton and no source fetch in page renders.
  const sql = postgres(config.DATABASE_URL, {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
  try {
    const assertBinding = async () => {
      const [row] =
        await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
      if (row?.namespace_digest !== credentialBindingDigest(config))
        throw new AccessFailure('forbidden');
    };
    await assertBinding();
    const source = {
      load: async (id: string) => {
        const record = await files.periods.load(id);
        await assertBinding();
        return record;
      },
    };
    const result = await createReviewedFileImporter(sql, source)(parsed.data);
    console.log(
      JSON.stringify({
        requestId,
        releaseSha: /^[a-f0-9]{40}$/.test(process.env.LABSD_RELEASE_SHA ?? '')
          ? process.env.LABSD_RELEASE_SHA
          : null,
        sourceMode: result.sourceMode,
        partnerId: result.partnerId,
        approvalId: result.approvalId,
        runId: result.runId,
        state: result.state,
        replayed: result.replayed,
        issueCount: result.issues.length,
      }),
    );
    if (result.state !== 'ready') process.exitCode = 2;
  } finally {
    await sql.end();
  }
}
const requestId = randomUUID();
main().catch((error) => {
  // Do not expose connection strings, filenames, file contents or provider error stacks to logs.
  const code =
    error instanceof AccessFailure ||
    error instanceof ImportFailure ||
    error instanceof ReviewedFileFailure
      ? error.code
      : 'unavailable';
  console.error(JSON.stringify({ requestId, state: 'failed', code }));
  process.exitCode = 1;
});
