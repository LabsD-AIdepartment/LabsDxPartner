import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import postgres from 'postgres';
import { connectTestDatabase } from './test-database.mjs';
import {
  assertProjectCluster,
  comparableSchema,
  identifier,
  restoreName,
  sourceForDrill,
  toolEnvironment,
} from './restore-drill-guards.mjs';

class DrillFailure extends Error {}
const root = resolve(import.meta.dirname, '..');
process.umask(0o077);
let stage = 'preflight',
  work,
  source,
  target;
const evidence = { status: 'running', startedAt: new Date().toISOString() };
const began = performance.now();
let schemaTarget;

async function freshDatabase(name) {
  const existing = await source`select 1 from pg_database where datname=${name}`;
  if (existing.length) throw new DrillFailure('Refusing existing target');
  await source.unsafe(`create database ${identifier(name)} template template0`);
  const url = sourceForDrill(process.env.LABSD_TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const db = postgres(url.toString(), { max: 2, connect_timeout: 5, onnotice: () => {} });
  try {
    const [binding] =
      await db`select current_database() as database,current_setting('data_directory') as directory`;
    if (binding.database !== name) throw new DrillFailure('Unexpected restore target');
    assertProjectCluster(binding.directory, root);
    if ((await tables(db)).length) throw new DrillFailure('Refusing nonempty restore target');
    return db;
  } catch (error) {
    await db.end();
    throw error;
  }
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function command(binary, args, database, label) {
  const log = await open(resolve(work, label + '.log'), 'wx', 0o600);
  try {
    await new Promise((accept, reject) => {
      const child = spawn(binary, args, {
        cwd: root,
        env: toolEnvironment(work, database),
        stdio: ['ignore', log.fd, log.fd],
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 300000);
      child.once('error', reject);
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) accept();
        else reject(new DrillFailure('Database tool failed: ' + label + ':' + (signal ?? code)));
      });
    });
  } finally {
    await log.close();
  }
}

async function tables(tx) {
  const unexpected = await tx`select count(*)::integer as count from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema'
    and c.relkind in ('p','f','m')`;
  if (unexpected[0].count)
    throw new DrillFailure(
      'Partitioned/foreign/materialized tables need an explicit drill extension',
    );
  return tx`select schemaname,tablename from pg_tables
    where schemaname !~ '^pg_' and schemaname<>'information_schema' order by schemaname,tablename`;
}

async function fingerprints(tx) {
  const output = [];
  for (const { schemaname, tablename } of await tables(tx)) {
    const table = identifier(schemaname) + '.' + identifier(tablename);
    const hash = createHash('sha256');
    let count = 0;
    // Hash all values, including duplicate rows, without printing or retaining values.
    // Sort fixed-size SHA256 row hashes so no primary-key assumption or sampling is needed.
    for await (const rows of tx
      .unsafe(
        `select digest from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as digest from ${table} t) hashes order by digest collate "C"`,
      )
      .cursor(2000)) {
      for (const row of rows) {
        hash.update(row.digest + '\n');
        count++;
      }
    }
    output.push({ table: schemaname + '.' + tablename, count, digest: hash.digest('hex') });
    process.stdout.write(
      'Checked table ' +
        output.length +
        ': ' +
        schemaname +
        '.' +
        tablename +
        ' (' +
        count +
        ' rows)\n',
    );
  }
  return output;
}

async function sequences(tx) {
  const result = [];
  const all =
    await tx`select n.nspname as schema,c.relname as name from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='S' and n.nspname !~ '^pg_' and n.nspname<>'information_schema' order by n.nspname,c.relname`;
  for (const row of all) {
    const [state] = await tx.unsafe(
      `select last_value::text,is_called from ${identifier(row.schema)}.${identifier(row.name)}`,
    );
    result.push({ ...row, ...state });
  }
  return result.sort((a, b) => (a.schema + '.' + a.name).localeCompare(b.schema + '.' + b.name));
}

try {
  if (process.argv.length !== 2)
    throw new DrillFailure('No arguments accepted; targets are generated');
  sourceForDrill(process.env.LABSD_TEST_DATABASE_URL);
  const pgBin = process.env.LABSD_PG_BIN;
  if (!pgBin || !isAbsolute(pgBin)) throw new DrillFailure('Set absolute LABSD_PG_BIN');
  const area = resolve(root, '.agent-work');
  if ((await lstat(area)).isSymbolicLink() || (await realpath(area)) !== area)
    throw new DrillFailure('Refusing redirected work area');
  const ignore = await readFile(resolve(root, '.gitignore'), 'utf8');
  if (!ignore.split('\n').some((line) => ['/.agent-work/', '.agent-work/'].includes(line.trim())))
    throw new DrillFailure('Work area must be ignored');
  const id = randomUUID().replaceAll('-', '');
  const name = restoreName(id);
  work = resolve(area, 'restore-' + new Date().toISOString().replaceAll(':', '-') + '-' + id);
  await mkdir(work, { mode: 0o700 });
  for (const folder of ['tmp', 'cache']) await mkdir(resolve(work, folder), { mode: 0o700 });
  evidence.targetDatabase = name;
  evidence.workDirectory = work;
  source = await connectTestDatabase();
  for (const row of await source`select pg_tablespace_location(oid) as location from pg_tablespace`)
    if (row.location) assertProjectCluster(await realpath(row.location), root);
  const [version] = await source`select current_setting('server_version_num')::integer as version`;
  if (Math.floor(version.version / 10000) !== 17)
    throw new DrillFailure('This drill is validated for PostgreSQL17');
  await command(resolve(pgBin, 'pg_dump'), ['--version'], 'labsd_partner_test', 'dump-version');
  await command(
    resolve(pgBin, 'pg_restore'),
    ['--version'],
    'labsd_partner_test',
    'restore-version',
  );
  await command(resolve(pgBin, 'psql'), ['--version'], 'labsd_partner_test', 'psql-version');
  for (const label of ['dump-version', 'restore-version', 'psql-version'])
    if (!/\(PostgreSQL\) 17\./.test(await readFile(resolve(work, label + '.log'), 'utf8')))
      throw new DrillFailure('PostgreSQL tool/server major mismatch');
  const archive = resolve(work, 'database.dump');
  let baseline, sequenceState;
  stage = 'backup-and-source-validation';
  const backupBegan = performance.now();
  await source.begin('isolation level repeatable read read only', async (tx) => {
    await tx`set local timezone='UTC'`;
    await tx`set local statement_timeout='120s'`;
    const [point] =
      await tx`select pg_export_snapshot() as snapshot, clock_timestamp() as captured_at`;
    evidence.recoveryPoint = point.captured_at.toISOString();
    sequenceState = await sequences(tx);
    await command(
      resolve(pgBin, 'pg_dump'),
      [
        '--no-password',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--snapshot=' + point.snapshot,
        '--file=' + archive,
      ],
      'labsd_partner_test',
      'dump',
    );
    await command(
      resolve(pgBin, 'pg_dump'),
      [
        '--no-password',
        '--schema-only',
        '--no-owner',
        '--no-privileges',
        '--snapshot=' + point.snapshot,
        '--file=' + resolve(work, 'source-schema.sql'),
      ],
      'labsd_partner_test',
      'source-schema',
    );
    baseline = await fingerprints(tx);
    if (JSON.stringify(sequenceState) !== JSON.stringify(await sequences(tx)))
      throw new DrillFailure(
        'Source sequences changed during capture; preserve artifacts and retry a fresh drill when writers are idle',
      );
    const ledger = await tx`select id,checksum from portal_meta.migrations order by id`;
    for (const row of ledger) {
      if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(row.id))
        throw new DrillFailure('Invalid migration identity');
      if ((await fileHash(resolve(root, 'db/migrations', row.id))) !== row.checksum)
        throw new DrillFailure('Applied migration/source checksum mismatch');
    }
    evidence.migrations = ledger.length;
  });
  evidence.backupAndSourceValidationMs = performance.now() - backupBegan;
  evidence.archiveBytes = (await stat(archive)).size;
  evidence.archiveSha256 = await fileHash(archive);
  stage = 'create-fresh-target';
  // No supplied target, --clean, DROP, overwrite or connection to the owner's database.
  // CREATE DATABASE itself rejects a collision, even if one appears after the check.
  target = await freshDatabase(name);
  stage = 'restore';
  const restoreBegan = performance.now();
  await command(
    resolve(pgBin, 'pg_restore'),
    [
      '--no-password',
      '--exit-on-error',
      '--single-transaction',
      '--no-owner',
      '--no-privileges',
      '--dbname=' + name,
      archive,
    ],
    name,
    'restore',
  );
  evidence.restoreMs = performance.now() - restoreBegan;
  stage = 'validate-restored-data';
  await target.begin('isolation level repeatable read read only', async (tx) => {
    await tx`set local timezone='UTC'`;
    await tx`set local statement_timeout='120s'`;
    const restored = await fingerprints(tx);
    if (JSON.stringify(baseline) !== JSON.stringify(restored))
      throw new DrillFailure('Full-table data comparison failed');
    if (JSON.stringify(sequenceState) !== JSON.stringify(await sequences(tx)))
      throw new DrillFailure('Sequence state comparison failed');
    evidence.tables = restored.map(({ table, count }) => ({ table, rows: count, matches: true }));
    evidence.totalRows = restored.reduce((sum, row) => sum + row.count, 0);
    evidence.sequences = sequenceState.length;
  });
  await command(
    resolve(pgBin, 'pg_dump'),
    [
      '--no-password',
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--file=' + resolve(work, 'target-schema.sql'),
    ],
    name,
    'target-schema',
  );
  // Reparse independently captured source DDL in another empty database. The
  // PostgreSQL parser flattens associative ANDs on restore; never strip SQL
  // parentheses with regex or confuse deparser formatting with a missing check.
  stage = 'validate-restored-schema';
  const schemaName = restoreName(randomUUID().replaceAll('-', ''));
  evidence.schemaReferenceDatabase = schemaName;
  schemaTarget = await freshDatabase(schemaName);
  await command(
    resolve(pgBin, 'psql'),
    [
      '--no-password',
      '-X',
      '--set=ON_ERROR_STOP=1',
      '--single-transaction',
      '--file=' + resolve(work, 'source-schema.sql'),
    ],
    schemaName,
    'schema-reference-restore',
  );
  await command(
    resolve(pgBin, 'pg_dump'),
    [
      '--no-password',
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--file=' + resolve(work, 'reference-schema.sql'),
    ],
    schemaName,
    'schema-reference-dump',
  );
  if (
    comparableSchema(await readFile(resolve(work, 'reference-schema.sql'), 'utf8')) !==
    comparableSchema(await readFile(resolve(work, 'target-schema.sql'), 'utf8'))
  )
    throw new DrillFailure('Schema comparison failed');
  evidence.schemaMatches = true;
  // Exercise the restored immutable-finance trigger; its rejection rolls back this transaction.
  let rejected = false;
  try {
    await target.begin(async (tx) => {
      await tx`update portal_statements.statements set id=id where id=(select id from portal_statements.statements limit 1)`;
      throw new DrillFailure('Immutable statement was not rejected');
    });
  } catch (error) {
    if (error.code === 'P0001' && error.message === 'Financial records are append-only')
      rejected = true;
    else throw error;
  }
  if (!rejected) throw new DrillFailure('Immutable trigger rejection missing');
  evidence.immutableStatementRejected = true;
  evidence.status = 'passed';
} catch (error) {
  evidence.failure = error instanceof DrillFailure ? error.message : 'CHECK_FAILED';
  evidence.status = 'failed';
  evidence.failedStage = stage;
  // Tool stderr may contain data. Keep it in the private work area, never echo it.
  process.exitCode = 1;
} finally {
  await schemaTarget?.end();
  await target?.end();
  await source?.end();
  evidence.elapsedMs = performance.now() - began;
  if (work)
    await writeFile(resolve(work, 'result.json'), JSON.stringify(evidence, null, 2), {
      mode: 0o600,
    });
  process.stdout.write(
    JSON.stringify({
      status: evidence.status,
      stage,
      workDirectory: work ?? null,
      totalRows: evidence.totalRows,
      elapsedMs: evidence.elapsedMs,
    }) + '\n',
  );
}
