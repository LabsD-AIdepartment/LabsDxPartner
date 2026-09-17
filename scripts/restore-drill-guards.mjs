import { resolve, sep } from 'node:path';

/** This drill is deliberately narrower than a general database restore tool. */
export function sourceForDrill(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid isolated source');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '55487' ||
    url.pathname !== '/labsd_partner_test' ||
    url.username !== 'labsd_test' ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Refusing non-isolated source');
  return url;
}

export function assertProjectCluster(directory, root) {
  if (!resolve(directory).startsWith(resolve(root, '.agent-work') + sep))
    throw new Error('Refusing cluster outside the project');
}

export function restoreName(id) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid restore identifier');
  return 'labsd_restore_' + id;
}

export function identifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

// pg_dump 17.6+ emits a different psql restriction nonce on each invocation.
// Preserve everything else: executable schema, constraints, functions, triggers.
export function comparableSchema(sql) {
  return sql
    .split('\n')
    .filter((line) => !/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line))
    .join('\n');
}

export function toolEnvironment(work, database) {
  return {
    PATH: process.env.PATH,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TMPDIR: resolve(work, 'tmp'),
    XDG_CACHE_HOME: resolve(work, 'cache'),
    PGHOST: '127.0.0.1',
    PGPORT: '55487',
    PGUSER: 'labsd_test',
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'labsd-local-restore-drill',
    PGPASSFILE: resolve(work, 'unused-password-file'),
  };
}
