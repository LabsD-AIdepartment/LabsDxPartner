import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createStaffAccountHttp } from '@/server/http/staff-account';
async function fixture() {
  const s = await setup();
  let profile: unknown = {
    partnerId: s.partnerId,
    sourceRevision: 'agreed-v1',
    evidenceRef: 'agreed-offline',
    agreement: null,
    termsSummary: null,
    supportUrl: null,
  };
  const source = { load: vi.fn(async () => profile) };
  const request = (action: 'inspect' | 'publish', body: unknown, headers = s.staff.headers) => {
    const h = new Headers(headers);
    h.set('origin', config.BETTER_AUTH_URL);
    h.set('content-type', 'application/json');
    return createStaffAccountHttp(
      access,
      source,
      config.BETTER_AUTH_URL,
      action,
    )(
      new Request(config.BETTER_AUTH_URL + '/api/v1/staff/account-profiles/' + action, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(body),
      }),
    );
  };
  const query = { partnerId: s.partnerId, reviewId: 'agreed-v1' };
  return {
    ...s,
    source,
    request,
    query,
    change: (v: unknown) => {
      profile = v;
    },
  };
}
describe('staff account profile HTTP', () => {
  it('inspects without a write, publishes reviewed content and replays safely', async () => {
    const s = await fixture();
    for (const reviewId of ['_deal', '-deal', '../deal'])
      expect((await s.request('inspect', { ...s.query, reviewId })).status).toBe(400);
    expect(s.source.load).not.toHaveBeenCalled();
    const response = await s.request('inspect', s.query);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const { profile, ...command } = await response.json();
    expect(command.expectedRevision).toBe('0');
    expect(
      await sql`select partner_id from portal_access.account_profiles where partner_id=${s.partnerId}`,
    ).toHaveLength(0);
    const input = { ...command, idempotencyKey: randomUUID() };
    const published = await s.request('publish', input);
    expect(published.status).toBe(200);
    expect(await published.json()).toEqual({ partnerId: s.partnerId, revision: '1' });
    expect((await s.request('publish', input)).status).toBe(200);
    expect(
      await sql`select snapshot from portal_access.account_profiles where partner_id=${s.partnerId}`,
    ).toEqual([{ snapshot: profile }]);
    expect(
      await sql`select id from portal_access.audit where actor_id=${s.staff.id} and action='publish-account-profile'`,
    ).toHaveLength(1);
  });
  it('rejects stale review and browser-provided terms', async () => {
    const s = await fixture();
    const { profile, ...command } = await (await s.request('inspect', s.query)).json();
    s.change({ ...profile, sourceRevision: 'changed' });
    expect((await s.request('publish', { ...command, idempotencyKey: randomUUID() })).status).toBe(
      409,
    );
    expect(
      (await s.request('publish', { ...command, profile, idempotencyKey: randomUUID() })).status,
    ).toBe(400);
    expect(
      await sql`select partner_id from portal_access.account_profiles where partner_id=${s.partnerId}`,
    ).toHaveLength(0);
  });
  it('authorizes before touching source; rejects foreign partner and rechecks grant after load', async () => {
    const s = await fixture();
    expect((await s.request('inspect', s.query, s.viewer.headers)).status).toBe(403);
    expect((await s.request('inspect', s.query, new Headers())).status).toBe(401);
    expect(s.source.load).not.toHaveBeenCalled();
    expect((await s.request('inspect', { ...s.query, partnerId: randomUUID() })).status).toBe(403);
    s.source.load.mockImplementationOnce(async () => {
      await sql`delete from portal_access.staff_grants where user_id=${s.staff.id}`;
      return {
        partnerId: s.partnerId,
        sourceRevision: '1',
        evidenceRef: 'signed',
        agreement: null,
        termsSummary: null,
        supportUrl: null,
      };
    });
    expect((await s.request('inspect', s.query)).status).toBe(403);
  });
  it('rejects foreign source ownership, malformed source and expired fresh authentication', async () => {
    const s = await fixture();
    s.change({
      partnerId: 'other',
      sourceRevision: '1',
      evidenceRef: 'signed',
      agreement: null,
      termsSummary: null,
      supportUrl: null,
    });
    expect((await s.request('inspect', s.query)).status).toBe(409);
    s.change({ private: 'not-for-browser' });
    const broken = await s.request('inspect', s.query);
    expect(broken.status).toBe(503);
    expect(await broken.text()).not.toContain('not-for-browser');
    s.change({
      partnerId: s.partnerId,
      sourceRevision: '1',
      evidenceRef: 'signed',
      agreement: null,
      termsSummary: null,
      supportUrl: null,
    });
    const { profile: _, ...command } = await (await s.request('inspect', s.query)).json();
    await sql`update portal_identity.sessions set created_at=clock_timestamp()-interval '1 hour' where user_id=${s.staff.id}`;
    const result = await s.request('publish', { ...command, idempotencyKey: randomUUID() });
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ code: 'FRESH_AUTH_REQUIRED' });
  });
  it('enforces JSON, origin, method and bounded requests', async () => {
    const s = await fixture(),
      handler = createStaffAccountHttp(access, s.source, config.BETTER_AUTH_URL, 'inspect');
    for (const [headers, body, status] of [
      [
        { origin: 'https://foreign.test', 'content-type': 'application/json' },
        JSON.stringify(s.query),
        403,
      ],
      [
        { origin: config.BETTER_AUTH_URL, 'content-type': 'text/plain' },
        JSON.stringify(s.query),
        400,
      ],
      [{ origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' }, '{broken', 400],
      [
        { origin: config.BETTER_AUTH_URL, 'content-type': 'application/json' },
        'x'.repeat(200_000),
        413,
      ],
    ] as const)
      expect(
        (await handler(new Request(config.BETTER_AUTH_URL, { method: 'POST', headers, body })))
          .status,
      ).toBe(status);
    expect((await handler(new Request(config.BETTER_AUTH_URL))).status).toBe(405);
  });
});
