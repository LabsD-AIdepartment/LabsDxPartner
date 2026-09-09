import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createReviewedFiles } from '@/server/adapters/reviewed-files/repository';
import { createReviewedFileImporter } from '@/server/modules/imports/from-reviewed-file';
import { createApprovalStore, reviewDigest } from '@/server/modules/imports/approval-store';
import { createStatementPublisher } from '@/server/modules/statements/publish';
import { createCataloguePublisher, catalogueDigest } from '@/server/modules/content/catalogue';
import { createSettlementImporter, settlementDigest } from '@/server/modules/statements/settle';
import { celebrityCatalogue } from '../../dev/financial/celebrity-catalogue';
import {
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '@/server/modules/identity/credential-auth';
let root: string;
beforeEach(async () => {
  const parent = resolve('.agent-work/runtime/tmp');
  await mkdir(parent, { recursive: true });
  root = await mkdtemp(join(parent, 'reviewed-import-'));
  for (const name of ['exports', 'controls', 'catalogues', 'settlements'])
    await mkdir(join(root, name));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function prepared() {
  const s = await setup(),
    reviewId = randomUUID(),
    files = createReviewedFiles(root);
  await writeFile(join(root, 'exports', reviewId + '.json'), s.sample.raw);
  await writeFile(join(root, 'controls', reviewId + '.json'), JSON.stringify(s.sample.context));
  const store = createApprovalStore(sql, access, files.periods);
  const approval = await store.approve(s.staff.headers, {
    reviewId,
    expectedDigest: reviewDigest(s.sample.raw, s.sample.context),
    idempotencyKey: randomUUID(),
  });
  const command = { approvalId: approval.id, idempotencyKey: randomUUID() };
  return {
    s,
    reviewId,
    files,
    store,
    approval,
    command,
    run: createReviewedFileImporter(sql, files.periods),
  };
}
describe('reviewed files into the existing financial authority', () => {
  it('requires database approval and imports exact reviewed rows once without publishing', async () => {
    const p = await prepared();
    await expect(p.run({ ...p.command, approvalId: randomUUID() })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const result = await p.run(p.command);
    expect(result).toMatchObject({
      state: 'ready',
      sourceMode: 'reviewed-file',
      replayed: false,
      partnerId: p.s.partnerId,
    });
    expect(await p.run(p.command)).toMatchObject({
      runId: result.runId,
      state: 'ready',
      replayed: true,
    });
    const [g] =
      await sql`select amount_minor::text,eligible_base_minor::text,included_count from portal_imports.generations where id=${result.runId}`;
    expect(g).toMatchObject({
      amount_minor: '3736000',
      eligible_base_minor: '55000000',
      included_count: 6,
    });
    const [issued] =
      await sql`select count(*)::int as n from portal_statements.statements where partner_id=${p.s.partnerId}`;
    expect(issued.n).toBe(0);
  });
  it('rejects changed raw or independent controls and preserves the existing good generation', async () => {
    const p = await prepared(),
      result = await p.run(p.command),
      path = join(root, 'exports', p.reviewId + '.json');
    await writeFile(path, p.s.sample.raw + ' ');
    await expect(p.run(p.command)).rejects.toMatchObject({ code: 'conflict' });
    await writeFile(path, p.s.sample.raw);
    await writeFile(
      join(root, 'controls', p.reviewId + '.json'),
      JSON.stringify({ ...p.s.sample.context, approvalRef: 'changed-control-review' }),
    );
    await expect(p.run({ ...p.command, idempotencyKey: randomUUID() })).rejects.toMatchObject({
      code: 'conflict',
    });
    const [scope] =
      await sql`select current_generation from portal_imports.scopes where partner_id=${p.s.partnerId}`;
    expect(scope.current_generation).toBe(result.runId);
  });
  it('checks revocation before acquisition and again after file reads', async () => {
    const p = await prepared();
    const run = createReviewedFileImporter(sql, {
      load: async (id) => {
        const source = await p.files.periods.load(id);
        await p.store.revoke(p.s.staff.headers, {
          approvalId: p.approval.id,
          reasonRef: 'withdrawn-source-review',
          idempotencyKey: randomUUID(),
        });
        return source;
      },
    });
    await expect(run(p.command)).rejects.toMatchObject({ code: 'forbidden' });
    let acquired = false;
    await expect(
      createReviewedFileImporter(sql, {
        load: async () => {
          acquired = true;
          throw new Error('Must not load');
        },
      })(p.command),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(acquired).toBe(false);
    const [runs] =
      await sql`select count(*)::int as n from portal_imports.runs where approval_sequence=${p.approval.sequence}`;
    expect(runs.n).toBe(0);
  });
  it('supplies reviewed catalogue and settlement files to their owning services', async () => {
    const p = await prepared(),
      result = await p.run(p.command);
    const issued = await createStatementPublisher(access)(p.s.staff.headers, {
      partnerId: p.s.partnerId,
      generationId: result.runId,
      approvalId: p.approval.id,
      scheduledAt: '2026-09-15T00:00:00Z',
      idempotencyKey: randomUUID(),
    });
    const catalogue = celebrityCatalogue(p.s.partnerId),
      reviewId = randomUUID();
    await writeFile(join(root, 'catalogues', reviewId + '.json'), JSON.stringify(catalogue));
    await createCataloguePublisher(access, p.files.catalogues)(p.s.staff.headers, {
      partnerId: p.s.partnerId,
      reviewId,
      expectedRevision: '0',
      expectedDigest: catalogueDigest(catalogue),
      idempotencyKey: randomUUID(),
    });
    const payment = {
      kind: 'payment',
      partnerId: p.s.partnerId,
      source: {
        authority: 'synthetic-finance',
        account: 'reviewed-files',
        reference: randomUUID(),
      },
      evidenceRef: 'bank-confirmed-file',
      occurredAt: '2026-09-01T00:00:00Z',
      cashMinor: '10000',
      withholdingMinor: '0',
      otherMinor: '0',
      allocations: [
        {
          statementId: issued.id,
          cashMinor: '10000',
          withholdingMinor: '0',
          otherMinor: '0',
          otherReasonRef: null,
        },
      ],
    };
    const sourceRecordId = randomUUID();
    await writeFile(join(root, 'settlements', sourceRecordId + '.json'), JSON.stringify(payment));
    const settle = createSettlementImporter(access, p.files.settlements),
      command = {
        sourceRecordId,
        expectedDigest: settlementDigest(payment),
        idempotencyKey: randomUUID(),
      };
    await settle(p.s.staff.headers, command);
    expect(await settle(p.s.staff.headers, command)).toMatchObject({ replayed: true });
    const overview = await p.s.read();
    expect(overview.data.earnings.confirmed?.minor).toBe('3736000');
    expect(overview.data.earnings.contentCount).toBe(6);
    expect(overview.data.profile).toMatchObject(catalogue.profile);
    const [paid] =
      await sql`select sum(cash_minor)::text as amount from portal_statements.allocations where partner_id=${p.s.partnerId}`;
    expect(paid.amount).toBe('10000');
  });
  it('runs the actual normal CLI with explicit flags/binding and safe output', async () => {
    const p = await prepared(),
      runFile = promisify(execFile);
    const env = {
      ...process.env,
      ...config,
      DATABASE_URL: process.env.LABSD_TEST_DATABASE_URL!,
      LABSD_IMPORT_ENABLED: '1',
      LABSD_REVIEW_DIRECTORY: root,
    };
    const prior =
      await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
    const digest = credentialBindingDigest(config);
    const args = [
      'scripts/run.mjs',
      'import:once',
      '--approval-id',
      p.approval.id,
      '--idempotency-key',
      p.command.idempotencyKey,
    ];
    try {
      await sql`insert into portal_identity.binding(id,namespace_digest) values(${CREDENTIAL_BINDING_ID},${digest}) on conflict(id) do update set namespace_digest=excluded.namespace_digest`;
      const result = await runFile(process.execPath, args, { env, timeout: 10000 });
      const receipt = JSON.parse(result.stdout.trim());
      expect(receipt).toMatchObject({
        state: 'ready',
        sourceMode: 'reviewed-file',
        replayed: false,
        partnerId: p.s.partnerId,
      });
      expect(receipt).not.toHaveProperty('context');
      expect(result.stdout + result.stderr).not.toContain(config.BETTER_AUTH_SECRET);
      expect(result.stdout + result.stderr).not.toContain(env.DATABASE_URL);
      const replay = JSON.parse(
        (await runFile(process.execPath, args, { env, timeout: 10000 })).stdout.trim(),
      );
      expect(replay).toMatchObject({ runId: receipt.runId, replayed: true });
      console.log(
        'Configured normal import CLI verified:',
        JSON.stringify({
          state: receipt.state,
          sourceMode: receipt.sourceMode,
          runId: receipt.runId,
          replayedOnRepeat: replay.replayed,
        }),
      );
      await expect(
        runFile(process.execPath, args, {
          env: { ...env, LABSD_IMPORT_ENABLED: '0' },
          timeout: 10000,
        }),
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('forbidden') });
      await sql`update portal_identity.binding set namespace_digest=${'0'.repeat(64)} where id=${CREDENTIAL_BINDING_ID}`;
      await expect(runFile(process.execPath, args, { env, timeout: 10000 })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining('forbidden'),
      });
    } finally {
      if (prior[0])
        await sql`update portal_identity.binding set namespace_digest=${prior[0].namespace_digest} where id=${CREDENTIAL_BINDING_ID}`;
      else await sql`delete from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
    }
  });
});
