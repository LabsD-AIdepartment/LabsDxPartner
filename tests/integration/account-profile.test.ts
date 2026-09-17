import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createAccountHttp } from '@/server/http/account';
import { AccountResponse } from '@/contracts/account';
import {
  createAccountProfilePublisher,
  accountProfileDigest,
} from '@/server/modules/account/profile';
async function fixture() {
  const s = await setup();
  const profile = {
    partnerId: s.partnerId,
    sourceRevision: 'signed-deal-1',
    evidenceRef: 'approved-deal',
    agreement: {
      id: 'deal-v1',
      partnerId: s.partnerId,
      effective: {
        from: '2026-01-01T00:00:00Z',
        toExclusive: '2027-01-01T00:00:00Z',
        timezone: 'Asia/Bangkok',
      },
      calculationPeriod: 'statement' as const,
      roundingRule: {
        mode: 'per-line' as const,
        tieBreak: 'half-away-from-zero' as const,
        allocation: 'none' as const,
      },
      evidenceRef: 'signed-deal',
    },
    termsSummary: 'Organic 10% · Brand ads 3%',
    supportUrl: 'https://example.test/support',
  };
  const source = { load: async () => profile };
  const publish = createAccountProfilePublisher(access, source);
  const command = () => ({
    partnerId: s.partnerId,
    reviewId: randomUUID(),
    expectedRevision: '0',
    expectedDigest: accountProfileDigest(profile),
    idempotencyKey: randomUUID(),
  });
  const request = (query: Record<string, string> = {}, headers = s.viewer.headers) =>
    createAccountHttp(access)(
      new Request(
        config.BETTER_AUTH_URL +
          '/api/v1/partner/account?' +
          new URLSearchParams({ partnerId: s.partnerId, permissionRevision: 'p1:m1', ...query }),
        { headers },
      ),
    );
  return { ...s, profile, source, publish, command, request };
}
describe('native account profile', () => {
  it('reports corrupted stored metadata as unavailable without exposing it', async () => {
    const s = await fixture();
    await s.publish(s.staff.headers, s.command());
    await sql`update portal_access.account_profiles set snapshot='{"unexpected":"private-source"}'::jsonb where partner_id=${s.partnerId}`;
    const result = await s.request();
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private-source');
  });
  it('returns credential identity and no invented agreement until a reviewed profile is published', async () => {
    const s = await fixture();
    const empty = await s.request();
    expect(empty.status).toBe(200);
    const initial = AccountResponse.parse(await empty.json());
    expect(initial.data.userId).toBe(s.viewer.id);
    expect(initial.data.agreement).toBeNull();
    expect(initial.data.termsSummary).toBeNull();
    const cmd = s.command();
    const result = await s.publish(s.staff.headers, cmd);
    expect(result.revision).toBe('1');
    const response = await s.request();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const data = AccountResponse.parse(await response.json());
    expect(data.data.agreement).toEqual(s.profile.agreement);
    expect(data.data.termsSummary).toBe(s.profile.termsSummary);
    expect(await s.publish(s.staff.headers, cmd)).toEqual(result);
    expect(
      await sql`select id from portal_access.audit where actor_id=${s.staff.id} and action='publish-account-profile'`,
    ).toHaveLength(1);
    expect(
      await sql`select id from portal_statements.statements where partner_id=${s.partnerId}`,
    ).toHaveLength(0);
  });
  it('permits content-only members but rejects foreign, stale, suspended and anonymous requests', async () => {
    const s = await fixture();
    await sql`update portal_access.memberships set capabilities=ARRAY['view_content'] where user_id=${s.viewer.id}`;
    expect((await s.request()).status).toBe(200);
    expect((await s.request({}, new Headers())).status).toBe(401);
    expect((await s.request({}, s.staff.headers)).status).toBe(403);
    expect((await s.request({ partnerId: randomUUID() })).status).toBe(403);
    expect((await s.request({ permissionRevision: 'p1:m2' })).status).toBe(409);
    expect((await s.request({ extra: 'bad' })).status).toBe(400);
    await sql`update portal_access.memberships set status='suspended' where user_id=${s.viewer.id}`;
    expect((await s.request()).status).toBe(403);
  });
  it('refuses a foreign agreement, source digest drift, stale publication and idempotency collisions', async () => {
    const s = await fixture(),
      cmd = s.command();
    s.profile.termsSummary = 'Changed';
    await expect(s.publish(s.staff.headers, cmd)).rejects.toMatchObject({ code: 'conflict' });
    const valid = s.command();
    await s.publish(s.staff.headers, valid);
    await expect(s.publish(s.staff.headers, s.command())).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      s.publish(s.staff.headers, { ...valid, reviewId: randomUUID() }),
    ).rejects.toMatchObject({ code: 'conflict' });
    s.profile.agreement.partnerId = randomUUID();
    expect(() => accountProfileDigest(s.profile)).toThrow();
  });
  it('serializes competing publication and requires fresh authorized staff', async () => {
    const s = await fixture();
    await expect(s.publish(s.viewer.headers, s.command())).rejects.toMatchObject({
      code: 'forbidden',
    });
    const results = await Promise.allSettled([
      s.publish(s.staff.headers, s.command()),
      s.publish(s.staff.headers, s.command()),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    await sql`update portal_identity.sessions set created_at=clock_timestamp()-interval '1 hour' where user_id=${s.staff.id}`;
    await expect(
      s.publish(s.staff.headers, { ...s.command(), expectedRevision: '1' }),
    ).rejects.toMatchObject({ code: 'fresh_auth_required' });
  });
});
