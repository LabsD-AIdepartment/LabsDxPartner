import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { resolve, sep } from 'node:path';

export async function startRestoredHttp(root: string, directory: string, output: string) {
  const build = resolve(directory);
  assert(build.startsWith(resolve(root, '.agent-work') + sep));
  assert.equal(await realpath(build), build);
  const idPath = resolve(build, '.next/BUILD_ID');
  assert.equal(await realpath(idPath), idPath);
  assert((await lstat(idPath)).isFile());
  const buildId = (await readFile(idPath, 'utf8')).trim();
  assert(/^[A-Za-z0-9_-]{1,100}$/.test(buildId));
  const log = createWriteStream(output + '.server.log', { flags: 'wx', mode: 0o600 });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    LC_ALL: 'en_US.UTF-8',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    LABSD_IDENTITY_ENABLED: '1',
    LABSD_FINANCE_ENABLED: '1',
    LABSD_MARKETING_ENABLED: '1',
    LABSD_ACCOUNT_PROFILE_ENABLED: '1',
  };
  const child = fork(resolve(root, 'tests/helpers/restored-http-child.ts'), [build], {
    cwd: root,
    env,
    execArgv: ['--import', 'tsx'],
    silent: true,
  });
  child.stdout!.pipe(log, { end: false });
  child.stderr!.pipe(log, { end: false });
  let final: { stopped: boolean; providerFetchAttempts: number } | undefined;
  child.on('message', (message) => {
    if (typeof message === 'object' && message && 'stopped' in message)
      final = message as typeof final;
  });
  const exited = new Promise<number | null>((done) =>
    child.once('exit', (code) => {
      log.end();
      done(code);
    }),
  );
  async function stop() {
    if (child.connected) child.send('stop');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    const code = await exited;
    clearTimeout(timer);
    assert.equal(code, 0);
    assert.equal(final?.stopped, true);
    assert.equal(final?.providerFetchAttempts, 0);
    return final;
  }
  let port: number;
  try {
    port = await new Promise<number>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('Recovery listener startup timeout')), 30000);
      child.once('error', (error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        fail(new Error('Recovery listener exited'));
      });
      child.on('message', (message) => {
        if (typeof message === 'object' && message && 'port' in message) {
          const value = message.port;
          if (typeof value === 'number' && value > 0 && value < 65536) {
            clearTimeout(timer);
            done(value);
          }
        }
      });
    });
  } catch (error) {
    child.kill('SIGKILL');
    await exited;
    throw error;
  }
  async function request(input: Request): Promise<Response> {
    const url = new URL(input.url);
    assert.equal(url.origin, env.BETTER_AUTH_URL);
    const body = input.body ? Buffer.from(await input.arrayBuffer()) : undefined;
    return new Promise((done, fail) => {
      const outgoing = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          method: input.method,
          path: url.pathname + url.search,
          headers: {
            ...Object.fromEntries(input.headers),
            host: url.host,
            'x-forwarded-host': url.host,
            'x-forwarded-proto': 'https',
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          incoming.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 16 * 1024 * 1024)
              incoming.destroy(new Error('Recovery response too large'));
            else chunks.push(chunk);
          });
          incoming.on('error', fail);
          incoming.on('end', () => {
            const headers = new Headers();
            for (let i = 0; i < incoming.rawHeaders.length; i += 2)
              headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
            done(new Response(Buffer.concat(chunks), { status: incoming.statusCode!, headers }));
          });
        },
      );
      outgoing.setTimeout(15000, () => outgoing.destroy(new Error('Recovery HTTP timeout')));
      outgoing.on('error', fail);
      outgoing.end(body);
    });
  }
  return { request, stop, buildId, port };
}
