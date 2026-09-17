import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { assertProjectCluster, sourceForDrill } from '../../scripts/restore-drill-guards.mjs';
import { Session } from '../../src/contracts/session';
import { OverviewResponse } from '../../src/contracts/overview-http';
import { ContentHttpResponse } from '../../src/contracts/content-http';
import { StatementListResponse } from '../../src/contracts/statements';
import { AccountResponse } from '../../src/contracts/account';
import { startRestoredHttp } from './restored-http-transport';

const root = resolve(import.meta.dirname, '../..');
const began = performance.now();
process.umask(0o077);
const evidence: Record<string, unknown> = {
  status: 'running',
  kind: 'restored-native-route-acceptance',
};
let stage = 'preflight';
let source: Awaited<ReturnType<typeof connectTestDatabase>> | undefined;
let target: ReturnType<typeof postgres> | undefined;
let output: string | undefined;
let http: Awaited<ReturnType<typeof startRestoredHttp>> | undefined;
const originalFetch = globalThis.fetch;
let fetchAttempts = 0;
async function privateFile(value: string | undefined) {
  if (!value) throw new Error('Missing project file');
  const path = resolve(value);
  assert(path.startsWith(resolve(root, '.agent-work') + sep));
  assert.equal(await realpath(path), path);
  const info = await lstat(path);
  assert(info.isFile() && info.size <= 65536);
  return { path, content: await readFile(path, 'utf8') };
}
const RestoreReceipt = z.object({
  status: z.literal('passed'),
  schemaMatches: z.literal(true),
  immutableStatementRejected: z.literal(true),
  targetDatabase: z.string().regex(/^labsd_restore_[a-f0-9]{32}$/),
  workDirectory: z.string(),
});
try {
  assert.equal(process.argv.length, 2);
  const receiptFile = await privateFile(process.env.LABSD_RESTORE_RESULT);
  const receipt = RestoreReceipt.parse(JSON.parse(receiptFile.content));
  assert.equal(receipt.workDirectory, dirname(receiptFile.path));
  output = resolve(receipt.workDirectory, 'app-acceptance-' + Date.now() + '.json');
  const configFile = await privateFile(process.env.LABSD_DRILL_IDENTITY_CONFIG);
  const config = z
    .object({
      DATABASE_URL: z.string(),
      BETTER_AUTH_URL: z.literal('https://127.0.0.1:4443'),
      BETTER_AUTH_SECRET: z.string().min(32),
    })
    .parse(JSON.parse(configFile.content));
  const dbUrl = sourceForDrill(config.DATABASE_URL);
  process.env.LABSD_TEST_DATABASE_URL = dbUrl.toString();
  source = await connectTestDatabase();
  dbUrl.pathname = '/' + receipt.targetDatabase;
  target = postgres(dbUrl.toString(), {
    max: 2,
    connect_timeout: 5,
    idle_timeout: 5,
    onnotice: () => {},
  });
  const [binding] =
    await target`select current_database() as name,current_setting('data_directory') as directory`;
  assert.equal(binding.name, receipt.targetDatabase);
  assertProjectCluster(await realpath(binding.directory), root);
  evidence.targetDatabase = receipt.targetDatabase;
  // Preserve the restored namespace and original logical origin. No binding/user
  // is inserted or reset; only the concrete database target changes in this process.
  Object.assign(process.env, {
    DATABASE_URL: dbUrl.toString(),
    BETTER_AUTH_URL: config.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
    LABSD_IDENTITY_ENABLED: '1',
    LABSD_FINANCE_ENABLED: '1',
    LABSD_MARKETING_ENABLED: '1',
  });
  globalThis.fetch = async () => {
    fetchAttempts++;
    throw new Error('No provider fetch permitted in restore acceptance');
  };
  const partnerId = 'fa8c1ffe-b1ea-428f-834c-ffaf1b32eaf4';
  const [user] = await target`select id from portal_identity.users where username='celeb_trial'`;
  assert(user);
  async function preserved(sql: ReturnType<typeof postgres>) {
    const rows =
      await sql`select (select jsonb_agg(to_jsonb(a) order by id) from portal_identity.accounts a where user_id=${user.id}) as accounts,
      (select jsonb_agg(to_jsonb(s) order by id) from portal_identity.sessions s where user_id=${user.id}) as sessions,
      (select jsonb_agg(to_jsonb(b) order by id) from portal_identity.binding b) as binding`;
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  const untouchedSource = await preserved(source);
  const namespaceBefore =
    await target`select id,namespace_digest from portal_identity.binding order by id`;
  const [sessionCountBefore] =
    await target`select count(*)::int as count from portal_identity.sessions where user_id=${user.id}`;
  stage = 'load-native-routes';
  if (process.env.LABSD_RESTORE_BUILD_DIRECTORY) {
    stage = 'built-service-start';
    http = await startRestoredHttp(root, process.env.LABSD_RESTORE_BUILD_DIRECTORY, output);
    evidence.kind = 'restored-built-http-acceptance';
    evidence.buildId = http.buildId;
  }
  const transport = http;
  const httpRoute = {
    GET: (request: Request, _context?: unknown) => transport!.request(request),
    POST: (request: Request) => transport!.request(request),
  };
  const auth = http ? httpRoute : await import('../../app/api/auth/[...all]/route');
  const sessionRoute = http ? httpRoute : await import('../../app/api/partner/session/route');
  const overview = http ? httpRoute : await import('../../app/api/v1/partner/overview/route');
  const content = http ? httpRoute : await import('../../app/api/v1/partner/content/route');
  const account = http ? httpRoute : await import('../../app/api/v1/partner/account/route');
  const statements = http ? httpRoute : await import('../../app/api/v1/partner/statements/route');
  const exportRoute = http
    ? httpRoute
    : await import('../../app/api/v1/partner/statements/[statementId]/export/route');
  const origin = config.BETTER_AUTH_URL;
  const make = (path: string, params: Record<string, string> = {}, headers = new Headers()) =>
    new Request(origin + path + '?' + new URLSearchParams(params), { headers });
  const loginRequest = (requestOrigin: string = origin) =>
    new Request(origin + '/api/auth/sign-in/username', {
      method: 'POST',
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'celeb_trial', password: 'native-trial-123' }),
    });
  stage = 'restored-login';
  assert.equal((await sessionRoute.GET(make('/api/partner/session'))).status, 401);
  assert.equal((await auth.POST(loginRequest('https://other.invalid'))).status, 403);
  const login = await auth.POST(loginRequest());
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie();
  assert(
    cookies.some(
      (cookie) =>
        cookie.includes('session_token=') && /Secure/i.test(cookie) && /HttpOnly/i.test(cookie),
    ),
  );
  const headers = new Headers({ cookie: cookies.map((cookie) => cookie.split(';')[0]).join('; ') });
  const response = await sessionRoute.GET(make('/api/partner/session', {}, headers));
  assert.equal(response.status, 200);
  const session = Session.parse(await response.json());
  assert.equal(session.userId, user.id);
  assert.equal(session.activePartnerId, partnerId);
  const member = session.memberships.find((member) => member.partnerId === partnerId);
  assert(member);
  const scope = { partnerId, permissionRevision: member.permissionRevision };
  const range = { ...scope, from: '2026-07-01', toExclusive: '2026-09-01' };
  const [sessionCountAfter] =
    await target`select count(*)::int as count from portal_identity.sessions where user_id=${user.id}`;
  assert.equal(sessionCountAfter.count, sessionCountBefore.count + 1);
  evidence.restoredPasswordAndMembership = true;
  stage = 'restored-financial-routes';
  const firstRead = performance.now();
  const overviewResponse = await overview.GET(make('/api/v1/partner/overview', range, headers));
  assert.equal(overviewResponse.status, 200);
  const report = OverviewResponse.parse(await overviewResponse.json());
  evidence[http ? 'firstOverviewHttpMs' : 'firstOverviewHandlerMs'] = performance.now() - firstRead;
  assert.equal(report.data.earnings.confirmed?.minor, '3736000');
  assert.equal(report.data.earnings.eligibleSales?.minor, '55000000');
  assert.equal(report.data.obligation.confirmedUnpaid?.minor, '3736000');
  assert.equal(report.data.profile?.portrait, '/media/celebrity-thumbnail.png');
  assert.equal(
    report.data.earnings.trend.reduce((sum, row) => sum + BigInt(row.amount.minor), 0n),
    3736000n,
  );
  const clipsResponse = await content.GET(
    make('/api/v1/partner/content', { ...range, resource: 'list' }, headers),
  );
  assert.equal(clipsResponse.status, 200);
  const clips = ContentHttpResponse.parse(await clipsResponse.json());
  assert.equal(clips.resource, 'list');
  if (clips.resource !== 'list') throw new Error('List expected');
  assert.equal(clips.result.data.items.length, 6);
  assert.equal(
    clips.result.data.items.reduce((total, clip) => total + BigInt(clip.earned!.minor), 0n),
    3736000n,
  );
  assert(clips.result.data.items.every((clip) => clip.cover?.startsWith('/media/')));
  const accountResponse = await account.GET(make('/api/v1/partner/account', scope, headers));
  assert.equal(accountResponse.status, 200);
  const restoredAccount = AccountResponse.parse(await accountResponse.json());
  assert.equal(restoredAccount.data.username, 'celeb_trial');
  assert.equal(restoredAccount.data.userId, user.id);
  assert.equal(restoredAccount.data.agreement?.partnerId, partnerId);
  assert.equal(restoredAccount.revision, '2');
  evidence.restoredAgreementRevision = restoredAccount.revision;
  const statementResponse = await statements.GET(
    make('/api/v1/partner/statements', scope, headers),
  );
  assert.equal(statementResponse.status, 200);
  const list = StatementListResponse.parse(await statementResponse.json());
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].closing.minor, '3736000');
  const file = await exportRoute.GET(
    make(
      '/api/v1/partner/statements/' + list.data.items[0].id + '/export',
      { partnerId, version: list.data.items[0].version },
      headers,
    ),
    { params: Promise.resolve({ statementId: list.data.items[0].id }) },
  );
  assert.equal(file.status, 200);
  assert(file.headers.get('content-disposition')?.includes('attachment'));
  const exportedBytes = new Uint8Array(await file.arrayBuffer());
  const csv = new TextDecoder('utf-8', { fatal: true }).decode(exportedBytes);
  // The known synthetic fixture has no embedded commas/newlines in text cells.
  // Reject a different shape rather than pretending this is a general CSV parser.
  const csvLines = csv.split('\r\n');
  assert.equal(
    csvLines[3],
    'line_id,earned_at,disposition,kind,content_id,agreement_version,eligible_sales_thb,rate_ppm,amount_thb,source_revision,original_line_id,reason_ref,evidence_ref',
  );
  const detailLines = csvLines
    .slice(4)
    .filter(Boolean)
    .map((line) => line.split(','));
  assert.equal(detailLines.length, 6);
  assert(detailLines.every((cells) => cells.length === 13));
  const minor = (value: string) => {
    assert(/^\d+\.\d{2}$/.test(value));
    return BigInt(value.replace('.', ''));
  };
  assert.equal(
    detailLines.reduce((sum, cells) => sum + minor(cells[8]), 0n),
    3736000n,
  );
  assert.equal(
    detailLines.reduce((sum, cells) => sum + minor(cells[6]), 0n),
    55000000n,
  );
  evidence.exportLines = detailLines.length;
  evidence.exportBytes = exportedBytes.byteLength;
  evidence.report = {
    confirmedMinor: '3736000',
    eligibleSalesMinor: '55000000',
    unpaidMinor: '3736000',
    clips: 6,
  };
  if (http) {
    stage = 'built-pages-and-assets';
    const assets = new Set<string>();
    for (const path of ['/login', '/overview', '/content', '/account', '/transactions']) {
      const page = await http.request(make(path, {}, headers));
      assert.equal(page.status, 200);
      assert(page.headers.get('content-type')?.includes('text/html'));
      const html = await page.text();
      assert(html.includes('Labs D'));
      for (const match of html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g))
        if (match[1].startsWith('/_next/static/')) assets.add(match[1]);
    }
    assert([...assets].some((path) => path.endsWith('.css')));
    assert([...assets].some((path) => path.endsWith('.js')));
    for (const path of [
      ...assets,
      '/media/celebrity-thumbnail.png',
      ...clips.result.data.items.map((clip) => clip.cover!),
    ]) {
      const asset = await http.request(make(path));
      assert.equal(asset.status, 200);
      assert((await asset.arrayBuffer()).byteLength > 0);
      assert(!asset.headers.get('content-type')?.includes('text/html'));
    }
    evidence.htmlPages = 5;
    evidence.staticBundles = assets.size;
    evidence.mediaRequests = 7;
  }
  stage = 'isolation-and-logout';
  const [foreign] =
    await target`select id from portal_access.partners where id<>${partnerId} limit 1`;
  assert(foreign);
  assert.equal(
    (
      await overview.GET(
        make('/api/v1/partner/overview', { ...range, partnerId: foreign.id }, headers),
      )
    ).status,
    403,
  );
  const signout = await auth.POST(
    new Request(origin + '/api/auth/sign-out', {
      method: 'POST',
      headers: new Headers({
        ...Object.fromEntries(headers),
        origin,
        'content-type': 'application/json',
      }),
      body: '{}',
    }),
  );
  assert.equal(signout.status, 200);
  assert.equal((await overview.GET(make('/api/v1/partner/overview', range, headers))).status, 401);
  assert.deepEqual(
    await target`select id,namespace_digest from portal_identity.binding order by id`,
    namespaceBefore,
  );
  assert.equal(await preserved(source), untouchedSource);
  assert.equal(fetchAttempts, 0);
  evidence.sourceIdentityUnchanged = true;
  evidence.namespaceUnchanged = true;
  evidence.foreignPartnerDenied = true;
  evidence.logoutRevokesSession = true;
  evidence.providerFetchAttempts = fetchAttempts;
  if (http) {
    await http.stop();
    http = undefined;
    evidence.listenerStopped = true;
  }
  evidence.status = 'passed';
} catch {
  evidence.status = 'failed';
  evidence.failedStage = stage;
  process.exitCode = 1;
} finally {
  if (http) {
    try {
      await http.stop();
    } catch {
      evidence.cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  globalThis.fetch = originalFetch;
  await target?.end();
  await source?.end();
  evidence.elapsedMs = performance.now() - began;
  if (output)
    await writeFile(output, JSON.stringify(evidence, null, 2), { mode: 0o600, flag: 'wx' });
  process.stdout.write(
    JSON.stringify({ status: evidence.status, stage, output, elapsedMs: evidence.elapsedMs }) +
      '\n',
  );
}
