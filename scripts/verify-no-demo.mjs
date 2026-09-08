import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export function assertProductionFlags(env) {
  for (const key of [
    'DEMO_AUTH',
    'DEMO_DATA',
    'NEXT_PUBLIC_DEMO_AUTH',
    'NEXT_PUBLIC_DEMO_DATA',
    'ENABLE_FIXTURES',
  ]) {
    if (env[key] && !['0', 'false'].includes(env[key].toLowerCase()))
      throw new Error(`Production cannot enable ${key}`);
  }
}
export function assertApplicationImports(root) {
  const walk = (p) =>
    readdirSync(p, { withFileTypes: true }).flatMap((x) =>
      x.isDirectory() ? walk(`${p}/${x.name}`) : [`${p}/${x.name}`],
    );
  for (const file of walk(root).filter((p) => /\.[cm]?[jt]sx?$/.test(p))) {
    if (
      /(?:from\s*|import\s*\()\s*['"][^'"]*(?:dev\/scenarios|foundation\/Gallery)/.test(
        readFileSync(file, 'utf8'),
      )
    )
      throw new Error(`Static fixture import in app: ${file}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  assertProductionFlags(process.env);
  assertApplicationImports(resolve(import.meta.dirname, '../app'));
  console.log('Production flags and application fixture-import boundary verified');
}

export function assertNoProductionFixtures(root) {
  const walk = (p) =>
    readdirSync(p, { withFileTypes: true }).flatMap((x) =>
      x.isDirectory() ? walk(p + '/' + x.name) : [p + '/' + x.name],
    );
  if (!existsSync(root)) throw new Error('Production static build is missing');
  for (const file of walk(root).filter((p) => p.endsWith('.js'))) {
    const text = readFileSync(file, 'utf8');
    if (
      [
        'synthetic-foundation-request',
        'synthetic-sale-',
        'Foundation components',
        'Access journey preview',
        'Overview journey preview',
        'Content journey preview',
        'synthetic-content-request',
        'synthetic-overview-request',
        'จำลองอนุมัติสิทธิ์',
      ].some((marker) => text.includes(marker))
    )
      throw new Error('Development fixture leaked into production: ' + file);
  }
}
