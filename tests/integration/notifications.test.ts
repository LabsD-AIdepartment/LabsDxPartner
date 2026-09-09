import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, sql, access, config } from '../helpers/partner-finance';
import { createNotificationsHttp } from '@/server/http/notifications';
import { createNotifications } from '@/server/modules/notifications/read-model';
import { createSettlementImporter, settlementDigest } from '@/server/modules/statements/settle';
import { NotificationResponse, SeenResponse } from '@/contracts/notifications-http';
import { createChangesHttp } from '@/server/http/changes';
type Fixture = Awaited<ReturnType<typeof setup>>;
const params = (s: Fixture) => ({ partnerId: s.partnerId, permissionRevision: 'p1:m1' });
const list = (s: Fixture, extra: Record<string, string> = {}, headers = s.viewer.headers) =>
  createNotificationsHttp(
    access,
    config.BETTER_AUTH_URL,
  )(
    new Request(
      config.BETTER_AUTH_URL +
        '/api/v1/partner/notifications?' +
        new URLSearchParams({ ...params(s), ...extra }),
      { headers },
    ),
  );
async function read(s: Fixture, extra: Record<string, string> = {}) {
  const response = await list(s, extra);
  if (response.status === 503)
    await createNotifications(access).read(s.viewer.headers, { ...params(s), ...extra });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return NotificationResponse.parse(await response.json()).data;
}
function mark(
  s: Fixture,
  id: string,
  origin = config.BETTER_AUTH_URL,
  extra: Record<string, string> = {},
) {
  const headers = new Headers(s.viewer.headers);
  headers.set('origin', origin);
  headers.set('content-type', 'application/json');
  return createNotificationsHttp(
    access,
    config.BETTER_AUTH_URL,
    true,
  )(
    new Request(config.BETTER_AUTH_URL + '/api/v1/partner/notifications/seen', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...params(s), throughNoticeId: id, ...extra }),
    }),
  );
}
function payment(s: Fixture, statementId: string) {
  return {
    kind: 'payment' as const,
    partnerId: s.partnerId,
    source: { authority: 'synthetic-notices', account: s.partnerId, reference: randomUUID() },
    evidenceRef: 'synthetic-payment',
    occurredAt: '2026-09-01T12:00:00Z',
    cashMinor: '100',
    withholdingMinor: '0',
    otherMinor: '0',
    allocations: [
      {
        statementId,
        cashMinor: '100',
        withholdingMinor: '0',
        otherMinor: '0',
        otherReasonRef: null,
      },
    ],
  };
}
async function pay(s: Fixture, record: unknown) {
  const cmd = {
    sourceRecordId: randomUUID(),
    expectedDigest: settlementDigest(record),
    idempotencyKey: randomUUID(),
  };
  const run = createSettlementImporter(access, { load: async () => record });
  return { result: await run(s.staff.headers, cmd), replay: () => run(s.staff.headers, cmd) };
}
describe('owned notifications and monotonic seen position', () => {
  it('indexes every historical statement and allocation with no orphan or duplicate projection', async () => {
    const [row] =
      await sql`with expected as (select partner_id,id as statement_id,null::uuid as settlement_id from portal_statements.statements
      union all select partner_id,statement_id,settlement_id from portal_statements.allocations),
      missing as (select * from expected except select partner_id,statement_id,settlement_id from portal_statements.notice_sources),
      extra as (select partner_id,statement_id,settlement_id from portal_statements.notice_sources except select * from expected)
      select (select count(*)::text from missing) as missing,(select count(*)::text from extra) as extra,
        (select count(*)::text from expected) as expected,(select count(*)::text from portal_statements.notice_sources) as actual`;
    expect(row.missing).toBe('0');
    expect(row.extra).toBe('0');
    expect(row.actual).toBe(row.expected);
  });
  it('starts empty, derives publication/payment/reversal once and updates change metadata', async () => {
    const s = await setup();
    expect(await read(s)).toMatchObject({ items: [], totalCount: 0, unseenCount: 0 });
    const issued = await (await s.ingest()).publish();
    const published = await read(s);
    expect(published.items[0]).toMatchObject({
      kind: 'statement-published',
      statementId: issued.id,
      seen: false,
    });
    const record = payment(s, issued.id),
      recorded = await pay(s, record);
    await recorded.replay();
    expect((await read(s)).totalCount).toBe(2);
    await pay(s, {
      kind: 'reversal',
      partnerId: s.partnerId,
      source: { ...record.source, reference: randomUUID() },
      original: record.source,
      evidenceRef: 'synthetic-reversal',
      reasonRef: 'synthetic-error',
      occurredAt: '2026-09-01T13:00:00Z',
    });
    const notices = await read(s);
    expect(notices.items.map((n) => n.kind)).toEqual([
      'payment-reversed',
      'payment-recorded',
      'statement-published',
    ]);
    const changes = await createChangesHttp(access)(
      new Request(
        config.BETTER_AUTH_URL +
          '/api/v1/partner/changes?' +
          new URLSearchParams({ ...params(s), capability: 'view_statements' }),
        { headers: s.viewer.headers },
      ),
    );
    expect((await changes.json()).noticesRevision).toBe('3');
    expect((await mark(s, notices.items[0].id)).status).toBe(200);
    expect((await read(s)).unseenCount).toBe(0);
    await mark(s, published.items[0].id);
    expect((await read(s)).unseenCount).toBe(0);
  });
  it('does not hide a payment committed while mark-seen is in flight', async () => {
    const s = await setup(),
      issued = await (await s.ingest()).publish();
    const old = (await read(s)).items[0];
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const delayed: typeof access.withPartner = (headers, partnerId, capability, run) =>
      access.withPartner(headers, partnerId, capability, async (tx, scope) => {
        entered();
        await gate;
        return run(tx, scope);
      });
    const pending = createNotifications({ ...access, withPartner: delayed }).seen(
      s.viewer.headers,
      { ...params(s), throughNoticeId: old.id },
    );
    await started;
    try {
      await pay(s, payment(s, issued.id));
    } finally {
      release();
    }
    await pending;
    const after = await read(s);
    expect(after.unseenCount).toBe(1);
    expect(after.items.map((n) => n.seen)).toEqual([false, true]);
  });
  it('isolates seen state per user and rejects foreign targets, revisions, capability loss and CSRF', async () => {
    const s = await setup(),
      other = await setup();
    await (await s.ingest()).publish();
    await (await other.ingest()).publish();
    const id = (await read(s)).items[0].id,
      foreign = (await read(other)).items[0].id;
    for (const response of [
      await mark(s, foreign),
      await mark(s, id, 'https://evil.example'),
      await mark(s, id, ''),
    ])
      expect(response.status).toBe(403);
    expect((await mark(s, id, config.BETTER_AUTH_URL, { userId: other.viewer.id })).status).toBe(
      400,
    );
    expect((await list(s, { permissionRevision: 'p1:m99' })).status).toBe(403);
    expect((await list(s, {}, new Headers())).status).toBe(401);
    await sql`insert into portal_access.memberships(id,partner_id,user_id,status,capabilities,verified_contact_ref)
      values(${randomUUID()},${s.partnerId},${other.viewer.id},'active',ARRAY['view_statements'],'synthetic')`;
    const normalizedHeaders = new Headers(s.viewer.headers);
    normalizedHeaders.set('origin', config.BETTER_AUTH_URL);
    normalizedHeaders.set('content-type', 'application/json');
    const normalized = await createNotificationsHttp(
      access,
      config.BETTER_AUTH_URL + '/',
      true,
    )(
      new Request(config.BETTER_AUTH_URL + '/api/v1/partner/notifications/seen', {
        method: 'POST',
        headers: normalizedHeaders,
        body: JSON.stringify({ ...params(s), throughNoticeId: id }),
      }),
    );
    expect(normalized.status).toBe(200);
    expect((await mark(s, id)).status).toBe(200);
    const second = NotificationResponse.parse(
      await (await list(s, {}, other.viewer.headers)).json(),
    );
    expect(second.data.unseenCount).toBe(1);
    await sql`update portal_access.memberships set capabilities=ARRAY['view_content'],permission_revision=2 where partner_id=${s.partnerId} and user_id=${s.viewer.id}`;
    expect((await list(s, { permissionRevision: 'p1:m2' })).status).toBe(403);
    expect((await mark(s, id)).status).toBe(403);
  });
  it('pages 20 notices without duplicates; cursor is bound to user/partner/revision', async () => {
    const s = await setup(),
      issued = await (await s.ingest()).publish();
    for (let i = 0; i < 23; i++) await pay(s, payment(s, issued.id));
    const first = await read(s);
    expect(first.items).toHaveLength(20);
    expect(first.totalCount).toBe(24);
    const next = await read(s, { cursor: first.nextCursor! });
    expect(next.items).toHaveLength(4);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map((n) => n.id)).size).toBe(24);
    const other = await setup();
    expect((await list(other, { cursor: first.nextCursor! })).status).toBe(409);
    expect((await list(s, { limit: '21' })).status).toBe(400);
    expect((await list(s, { cursor: 'not-json' })).status).toBe(400);
    const marker = SeenResponse.parse(await (await mark(s, next.items[0].id)).json());
    expect(marker.throughNoticeId).toBe(next.items[0].id);
    expect((await read(s)).unseenCount).toBe(20);
  });
  it('rolls back notice projection and revision with its source transaction', async () => {
    const s = await setup(),
      issued = await (await s.ingest()).publish();
    const before = await read(s);
    await expect(
      sql.begin(async (tx) => {
        const id = randomUUID();
        await tx`insert into portal_statements.settlements(id,partner_id,authority,account,reference,record_digest,kind,evidence_ref,occurred_at,recorded_by)
        values(${id},${s.partnerId},'synthetic','rollback',${id},'synthetic','payment','synthetic',clock_timestamp(),${s.staff.id})`;
        await tx`insert into portal_statements.allocations(partner_id,settlement_id,statement_id,cash_minor,withholding_minor,other_minor)
        values(${s.partnerId},${id},${issued.id},1,0,0)`;
        throw new Error('Synthetic rollback');
      }),
    ).rejects.toThrow('Synthetic rollback');
    expect(await read(s)).toEqual(before);
  });
});
