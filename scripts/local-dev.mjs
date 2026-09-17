import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

// One local application, from the current checkout, with the existing identity namespace.
const root = resolve(import.meta.dirname, '..');
const local = resolve(root, '.local');
const configPath = resolve(local, 'environment.json');
if (!existsSync(configPath)) {
  console.error(
    'Local runtime configuration is missing. See docs/implementation/local-runtime.md.',
  );
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, 'utf8'));
// Local credentials are resolved by reference at startup, never stored in configuration or argv.
const credentialEnv = {};
const profiles = JSON.parse(config.LABSD_FACEBOOK_PROFILES || '[]');
for (const [name, service] of Object.entries(JSON.parse(config.LABSD_LOCAL_KEYCHAIN_REFS || '{}'))) {
  if (!/^LABSD_FB_[A-Z0-9_]+_TOKEN$/.test(name) ||
      !profiles.some((profile) => profile.tokenEnv === name) ||
      typeof service !== 'string' || !/^[A-Za-z0-9_.-]{1,160}$/.test(service))
    throw new Error('Invalid local credential reference.');
  try {
    credentialEnv[name] = execFileSync('/usr/bin/security',
      ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new Error('Local provider credential unavailable.');
  }
}
const origin = new URL(config.BETTER_AUTH_URL);
if (
  config.BETTER_AUTH_URL !== 'https://127.0.0.1:4443' ||
  config.LABSD_IDENTITY_ENABLED !== '1' ||
  !config.DATABASE_URL ||
  !config.BETTER_AUTH_SECRET
) {
  throw new Error(
    'Local runtime requires the existing https://127.0.0.1:4443 identity configuration.',
  );
}
const key = resolve(local, 'tls/key.pem');
const cert = resolve(local, 'tls/cert.pem');
if (!existsSync(key) || !existsSync(cert)) throw new Error('Local TLS certificate is missing.');
const child = spawn(
  process.execPath,
  [
    resolve(root, 'node_modules/next/dist/bin/next'),
    'dev',
    '--hostname',
    origin.hostname,
    '--port',
    origin.port,
    '--experimental-https',
    '--experimental-https-key',
    key,
    '--experimental-https-cert',
    cert,
  ],
  {
    cwd: root,
    env: { ...process.env, ...config, ...credentialEnv, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  },
);
console.log(`Local application: ${origin.origin}/login (current checkout)`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
child.on('error', () => {
  console.error('Local application failed to start.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
