import { beforeAll, afterAll, expect, it } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createTikTokQuota } from '@/server/modules/marketing-ads/tiktok-shop/quota';
const exec = promisify(execFile);
const work = resolve('.agent-work/runtime/redis-quota', randomUUID());
let child: ChildProcess, port: number;
async function command(...args: string[]) {
  const result = await exec(
    'redis-cli',
    ['--json', '-h', '127.0.0.1', '-p', String(port), ...args],
    { timeout: 2000, env: { ...process.env, TMPDIR: work } },
  );
  // Redis CLI may exit0 for a Redis error; reject its non-JSON error text too.
  return JSON.parse(result.stdout);
}
const evalPort = async (script: string, numberOfKeys: number, ...args: (string | number)[]) =>
  command('EVAL', script, String(numberOfKeys), ...args.map(String));
const signal = () => new AbortController().signal;
beforeAll(async () => {
  mkdirSync(work, { recursive: true });
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  child = spawn(
    'redis-server',
    [
      '--bind',
      '127.0.0.1',
      '--port',
      String(port),
      '--save',
      '',
      '--appendonly',
      'no',
      '--daemonize',
      'no',
      '--dir',
      work,
      '--logfile',
      resolve(work, 'redis.log'),
    ],
    { env: { ...process.env, TMPDIR: work }, stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error('Owned Redis failed to start');
    try {
      if ((await command('PING')) === 'PONG') return;
    } catch {
      /* wait for this owned handle */
    }
    await delay(25);
  }
  throw new Error('Owned Redis readiness deadline');
});
afterAll(async () => {
  if (child?.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    writeFileSync(
      resolve(work, 'receipt.json'),
      JSON.stringify({
        port,
        pid: child.pid,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        stopped: true,
      }),
    );
  }
});
it('atomically shares the app budget across separate governors and refills from Redis time', async () => {
  const appKey = randomUUID();
  const a = createTikTokQuota({ appPerSecond: 1, shopPerSecond: 1, eval: evalPort });
  const b = createTikTokQuota({ appPerSecond: 1, shopPerSecond: 1, eval: evalPort });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? a : b).reserve({ appKey, shopCipher: 'shop-' + i }, signal()),
    ),
  );
  expect(results.filter((r) => r.allowed)).toHaveLength(1);
  expect(results.filter((r) => !r.allowed).every((r) => !r.allowed && r.retryAfterMs > 0)).toBe(
    true,
  );
  await delay(1050);
  expect(await b.reserve({ appKey, shopCipher: 'next' }, signal())).toEqual({ allowed: true });
});
it('does not charge the app when its shop bucket denies, and isolates other apps', async () => {
  const appKey = randomUUID();
  const q = createTikTokQuota({ appPerSecond: 2, shopPerSecond: 1, eval: evalPort });
  expect((await q.reserve({ appKey, shopCipher: 'a' }, signal())).allowed).toBe(true);
  expect((await q.reserve({ appKey, shopCipher: 'a' }, signal())).allowed).toBe(false);
  expect((await q.reserve({ appKey, shopCipher: 'b' }, signal())).allowed).toBe(true);
  expect((await q.reserve({ appKey, shopCipher: 'c' }, signal())).allowed).toBe(false);
  expect((await q.reserve({ appKey: randomUUID(), shopCipher: 'a' }, signal())).allowed).toBe(true);
});
it('rejects disagreeing caller policies and corrupt Redis state', async () => {
  const appKey = randomUUID();
  let keys: string[] = [];
  const capture = async (script: string, n: number, ...args: (string | number)[]) => {
    keys = args.slice(0, n).map(String);
    return evalPort(script, n, ...args);
  };
  const q = createTikTokQuota({ appPerSecond: 2, shopPerSecond: 1, eval: capture });
  await q.reserve({ appKey }, signal());
  const different = createTikTokQuota({ appPerSecond: 3, shopPerSecond: 1, eval: evalPort });
  await expect(different.reserve({ appKey }, signal())).rejects.toMatchObject({
    code: 'temporary',
  });
  await command('HSET', keys[0], 'tokens', 'broken');
  await expect(q.reserve({ appKey }, signal())).rejects.toMatchObject({ code: 'temporary' });
});
