import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createMarketingProvisioner } from '@/server/modules/marketing-ads/provision';
import { createMarketingConnections } from '@/server/modules/marketing-ads/connections';
import { createFacebookAccountVerifier } from '@/server/modules/marketing-ads/facebook/verify-account';
import { createMarketingRegistration } from '@/server/modules/marketing-ads/registration';
import { createMarketingProviderRegistry } from '@/server/modules/marketing-ads/provider';
import {
  credentialBindingDigest,
  CREDENTIAL_BINDING_ID,
} from '@/server/modules/identity/credential-auth';
import { createShopVideoProvisioner } from '@/server/modules/marketing-ads/tiktok-shop/video-provision';
import { createShopVideoRegistration } from '@/server/modules/marketing-ads/tiktok-shop/video-registration';
import type { FacebookProfile } from '@/server/modules/marketing-ads/facebook/config';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
let priorBinding: string | undefined;
beforeEach(async () => {
  const [prior] =
    await sql`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
  priorBinding = prior?.namespace_digest;
  await sql`insert into portal_identity.binding(id,namespace_digest) values(${CREDENTIAL_BINDING_ID},${credentialBindingDigest(config)}) on conflict(id) do update set namespace_digest=excluded.namespace_digest`;
});
afterEach(async () => {
  if (priorBinding)
    await sql`update portal_identity.binding set namespace_digest=${priorBinding} where id=${CREDENTIAL_BINDING_ID}`;
  else await sql`delete from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
});
async function fixture() {
  const f = await setup();
  const profile: FacebookProfile = {
    id: randomUUID(),
    namespace: randomUUID(),
    accountId: '123456',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    acquisitionOwner: 'portal-direct',
    tokenEnv: 'LABSD_FB_TEST_TOKEN',
  };
  const service = createMarketingProvisioner(sql, [profile], async (tx) => {
    const [row] =
      await tx`select namespace_digest from portal_identity.binding where id=${CREDENTIAL_BINDING_ID}`;
    expect(row.namespace_digest).toBe(credentialBindingDigest(config));
    return 'synthetic-target';
  });
  const command = {
    schemaVersion: 1,
    commandId: randomUUID(),
    operatorRef: 'synthetic-operator',
    evidenceRef: 'mock onboarding approval',
    connectionId: profile.id,
    expectedRevision: null as string | null,
    label: 'Synthetic account',
    grantUserIds: [f.staff.id],
    revokeUserIds: [] as string[],
  };
  async function apply(cmd = command) {
    const preview = await service.preview(cmd);
    return service.apply(cmd, preview.planHash);
  }
  return { ...f, profile, service, command, apply };
}
describe('trusted marketing account provisioning', () => {
  it('previews without writes, creates disabled account plus grant, replays and records immutable evidence', async () => {
    const f = await fixture(),
      preview = await f.service.preview(f.command);
    expect(preview).toMatchObject({
      state: 'preview',
      plan: { before: null, changes: { create: true, grantUserIds: [f.staff.id] } },
    });
    expect(
      await sql`select id from portal_marketing.connections where id=${f.profile.id}`,
    ).toHaveLength(0);
    expect(
      await sql`select id from portal_marketing.provision_commands where id=${f.command.commandId}`,
    ).toHaveLength(0);
    const result = await f.service.apply(f.command, preview.planHash);
    expect(result).toMatchObject({
      state: 'applied',
      result: { enabled: false, revision: '1', granted: 1, revoked: 0 },
    });
    expect(await f.service.apply(f.command, preview.planHash)).toMatchObject({
      state: 'replayed',
      result: result.result,
    });
    expect(await f.service.preview(f.command)).toMatchObject({ state: 'already-applied' });
    expect(
      await sql`select user_id from portal_marketing.connection_grants where connection_id=${f.profile.id}`,
    ).toEqual([{ user_id: f.staff.id }]);
    await expect(
      sql`delete from portal_marketing.provision_commands where id=${f.command.commandId}`,
    ).rejects.toThrow();
    await expect(
      f.service.apply({ ...f.command, label: 'changed' }, preview.planHash),
    ).rejects.toMatchObject({ code: 'command-conflict' });
  });
  it('preserves enabled/verification state while making grant changes and rejects stale reviewed plans', async () => {
    const f = await fixture();
    await f.apply();
    await sql`update portal_marketing.connections set enabled=true,verified_at=clock_timestamp() where id=${f.profile.id}`;
    const command = {
      ...f.command,
      commandId: randomUUID(),
      expectedRevision: '2',
      grantUserIds: [],
      revokeUserIds: [f.staff.id],
    };
    const preview = await f.service.preview(command);
    await sql`update portal_marketing.connections set label='Another change' where id=${f.profile.id}`;
    await expect(f.service.apply(command, preview.planHash)).rejects.toMatchObject({
      code: 'stale-plan',
    });
    const result = await f.apply({ ...command, expectedRevision: '3' });
    expect(result.result).toMatchObject({ enabled: true, revision: '4', revoked: 1 });
    expect(
      await sql`select * from portal_marketing.connection_grants where connection_id=${f.profile.id}`,
    ).toHaveLength(0);
  });
  it('never grants nonstaff/inactive users and leaves no partial account on an invalid delta', async () => {
    const f = await fixture();
    await expect(
      f.service.preview({ ...f.command, grantUserIds: [f.staff.id, f.viewer.id] }),
    ).rejects.toMatchObject({ code: 'ineligible-staff' });
    const preview = await f.service.preview(f.command);
    await sql`update portal_access.staff_grants set active=false where user_id=${f.staff.id}`;
    await expect(f.service.apply(f.command, preview.planHash)).rejects.toMatchObject({
      code: 'ineligible-staff',
    });
    expect(
      await sql`select id from portal_marketing.connections where id=${f.profile.id}`,
    ).toHaveLength(0);
  });
  it('fences changed staff revision and target namespace even when permissions look the same', async () => {
    const f = await fixture(),
      preview = await f.service.preview(f.command);
    await sql`update portal_access.staff_grants set revision=revision+1 where user_id=${f.staff.id}`;
    await expect(f.service.apply(f.command, preview.planHash)).rejects.toMatchObject({
      code: 'stale-plan',
    });
    const other = createMarketingProvisioner(sql, [f.profile], async () => 'other-target');
    await expect(other.apply(f.command, preview.planHash)).rejects.toMatchObject({
      code: 'stale-plan',
    });
    const denied = createMarketingProvisioner(sql, [f.profile], async () => {
      throw new Error('binding rejected');
    });
    await expect(denied.preview(f.command)).rejects.toThrow('binding rejected');
  });
  it('serializes duplicate application and refuses changing the account under an existing connection ID', async () => {
    const f = await fixture(),
      preview = await f.service.preview(f.command);
    const results = await Promise.all([
      f.service.apply(f.command, preview.planHash),
      f.service.apply(f.command, preview.planHash),
    ]);
    expect(results.map((r) => r.state).sort()).toEqual(['applied', 'replayed']);
    const changed = createMarketingProvisioner(
      sql,
      [{ ...f.profile, accountId: '999' }],
      async () => 'synthetic-target',
    );
    await expect(
      changed.preview({ ...f.command, commandId: randomUUID(), expectedRevision: '1' }),
    ).rejects.toMatchObject({ code: 'identity-mismatch' });
  });
  it('provisions -> existing staff panel verifies -> registers lookup -> revocation fences the receipt', async () => {
    const f = await fixture();
    await f.catalogue();
    await f.apply();
    const fetcher = vi.fn(async () =>
      Response.json({
        id: 'act_123456',
        account_id: '123456',
        currency: 'THB',
        timezone_name: 'Asia/Bangkok',
      }),
    );
    const verifier = createFacebookAccountVerifier(
      sql,
      {
        LABSD_FACEBOOK_READ_ENABLED: '1',
        LABSD_FACEBOOK_PROFILES: JSON.stringify([f.profile]),
        LABSD_FB_TEST_TOKEN: 'synthetic-only',
      },
      async () => {},
      { fetch: fetcher },
    );
    const lifecycle = createMarketingConnections(access, verifier),
      scope = { actorId: f.staff.id, permissionRevision: '1' };
    expect((await lifecycle.read(f.staff.headers, scope)).connections).toMatchObject([
      { enabled: false, configured: true },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    await lifecycle.command(
      f.staff.headers,
      {
        ...scope,
        connectionId: f.profile.id,
        revision: '1',
        action: 'verify',
        idempotencyKey: randomUUID(),
      },
      new AbortController().signal,
    );
    const target = randomUUID();
    await sql`insert into portal_marketing.targets(id,partner_id,clip_id,agreement_id,agreement_label,evidence_ref) values(${target},${f.partnerId},'clip-1','mock','Mock','Mock only')`;
    const providers = createMarketingProviderRegistry([
      {
        capability: 'facebook.ad_insights',
        resolve: async (identity) => ({
          schemaVersion: 2,
          identity,
          apiVersion: 'v25.0',
          sourceRevision: null,
          name: 'Mock',
          creativeIds: ['123'],
          fetchedAt: new Date().toISOString(),
        }),
        report: async () => {
          throw Error('unused');
        },
      },
    ]);
    const registration = createMarketingRegistration(access, providers),
      lookup = {
        ...scope,
        draft: {
          targetId: target,
          connectionId: f.profile.id,
          platform: 'facebook',
          externalId: '789',
        },
      };
    const receipt = await registration.resolve(
      f.staff.headers,
      lookup,
      new AbortController().signal,
    );
    await f.apply({
      ...f.command,
      commandId: randomUUID(),
      expectedRevision: '2',
      grantUserIds: [],
      revokeUserIds: [f.staff.id],
    });
    await expect(
      registration.save(f.staff.headers, {
        ...lookup,
        receipt: receipt.receipt,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await lifecycle.read(f.staff.headers, scope)).connections).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['facebook', 'tiktok'] as const)(
    'runs the real %s operator command in preview then apply without a source token or read-enable flag',
    async (platform) => {
      const f = await fixture(),
        dir = resolve('.agent-work/20260910-provisioning/tmp', randomUUID());
      mkdirSync(dir, { recursive: true });
      const file = resolve(dir, 'command.json');
      writeFileSync(file, JSON.stringify(f.command));
      const run = (args: string[]) =>
        new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
          const child = spawn(
            process.execPath,
            ['scripts/run.mjs', 'marketing:provision', '--platform', platform, ...args],
            {
              timeout: 10000,
              env: {
                ...process.env,
                DATABASE_URL: process.env.LABSD_TEST_DATABASE_URL,
                BETTER_AUTH_URL: config.BETTER_AUTH_URL,
                BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
                LABSD_FACEBOOK_PROFILES: JSON.stringify([f.profile]),
                LABSD_TIKTOK_VIDEO_PROFILES: JSON.stringify([
                  {
                    connectionId: f.profile.id,
                    namespace: f.profile.namespace,
                    shopId: f.profile.accountId,
                    currency: f.profile.currency,
                    timezone: f.profile.timezone,
                    acquisitionOwner: 'sale-dashboard',
                    sourceConnectionRef: 'synthetic-shop-connection',
                  },
                ]),
                LABSD_TIKTOK_VIDEO_ENABLED: '0',
                LABSD_FACEBOOK_READ_ENABLED: '0',
                LABSD_FB_TEST_TOKEN: '',
              },
            },
          );
          let stdout = '',
            stderr = '';
          child.stdout.on('data', (x) => (stdout += x));
          child.stderr.on('data', (x) => (stderr += x));
          child.on('error', reject);
          child.on('close', (code) => done({ code, stdout, stderr }));
        });
      const inspected = await run(['--inspect']);
      expect(inspected.code).toBe(0);
      expect(JSON.parse(inspected.stdout).eligibleStaff.length).toBeGreaterThan(0);
      const preview = await run([file]);
      expect(preview.code).toBe(0);
      expect(preview.stdout).not.toContain('TOKEN');
      const parsed = JSON.parse(preview.stdout);
      expect(parsed.state).toBe('preview');
      const advanced = await run(['--inspect', '--staff-after', f.staff.id]);
      expect(advanced.code).toBe(0);
      expect(
        JSON.parse(advanced.stdout).eligibleStaff.every(
          (s: { user_id: string }) => s.user_id !== f.staff.id,
        ),
      ).toBe(true);
      const applied = await run([file, '--apply', '--plan-hash', parsed.planHash]);
      expect(applied.code).toBe(0);
      expect(JSON.parse(applied.stdout)).toMatchObject({
        state: 'applied',
        result: { enabled: false, granted: 1 },
      });
      const privateMarker = 'PRIVATE_TEST_INPUT_DO_NOT_LOG';
      writeFileSync(file, privateMarker);
      const invalid = await run([file]);
      expect(invalid.code).toBe(1);
      expect(JSON.parse(invalid.stderr)).toMatchObject({ code: 'invalid-input' });
      expect(invalid.stdout + invalid.stderr).not.toContain(privateMarker);
      expect(preview.stdout + applied.stdout).not.toContain(config.BETTER_AUTH_SECRET);
    },
  );
});

describe('TikTok shop operator provisioning', () => {
  async function shopFixture() {
    const f = await fixture();
    const profile = {
      connectionId: f.profile.id,
      namespace: f.profile.namespace,
      shopId: f.profile.accountId,
      currency: f.profile.currency,
      timezone: f.profile.timezone,
      acquisitionOwner: 'sale-dashboard' as const,
      sourceConnectionRef: randomUUID(),
    };
    const service = createShopVideoProvisioner(sql, [profile], async () => 'synthetic-target');
    return { ...f, shopProfile: profile, shopService: service };
  }
  it('creates an audited disabled shop with only explicit grants and exposes it as unavailable in marketing', async () => {
    const f = await shopFixture();
    const preview = await f.shopService.preview(f.command);
    expect(preview).toMatchObject({
      plan: {
        profile: {
          platform: 'tiktok',
          capability: 'tiktok.shop_video',
          sourceConnectionRef: f.shopProfile.sourceConnectionRef,
        },
      },
    });
    expect(
      await sql`select id from portal_marketing.connections where id=${f.profile.id}`,
    ).toHaveLength(0);
    const result = await f.shopService.apply(f.command, preview.planHash);
    expect(result).toMatchObject({ state: 'applied', result: { enabled: false, granted: 1 } });
    const [row] =
      await sql`select platform,capability,verified_at from portal_marketing.connections where id=${f.profile.id}`;
    expect(row).toEqual({ platform: 'tiktok', capability: 'tiktok.shop_video', verified_at: null });
    expect(await f.shopService.apply(f.command, preview.planHash)).toMatchObject({
      state: 'replayed',
    });
    const options = await createShopVideoRegistration(access).options(f.staff.headers, {
      actorId: f.staff.id,
      permissionRevision: '1',
      q: '',
    });
    expect(options.connections).toEqual([
      { id: f.profile.id, label: f.command.label, available: false },
    ]);
    await expect(
      sql`delete from portal_marketing.provision_commands where id=${f.command.commandId}`,
    ).rejects.toThrow();
  });
  it('rejects cross-platform account reuse and replay rather than treating an existing Facebook result as TikTok success', async () => {
    const f = await shopFixture();
    await f.apply();
    await expect(f.shopService.preview(f.command)).rejects.toMatchObject({
      code: 'identity-mismatch',
    });
    await expect(f.shopService.inspect()).rejects.toMatchObject({ code: 'identity-mismatch' });
  });
  it('invalidates a reviewed plan if the source-owner reference changes before apply', async () => {
    const f = await shopFixture();
    const preview = await f.shopService.preview(f.command);
    const changed = createShopVideoProvisioner(
      sql,
      [{ ...f.shopProfile, sourceConnectionRef: 'another-owner-shop' }],
      async () => 'synthetic-target',
    );
    await expect(changed.apply(f.command, preview.planHash)).rejects.toMatchObject({
      code: 'stale-plan',
    });
    expect(
      await sql`select id from portal_marketing.connections where id=${f.profile.id}`,
    ).toHaveLength(0);
  });
});
