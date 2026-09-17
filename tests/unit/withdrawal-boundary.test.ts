// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';

// N1 mandatory boundary test (round-2, F07).
//
// The dev-only synthetic withdrawal adapter imports three AUDITED pure server modules
// (withdrawals/balance, withdrawals/readiness, earnings/money) for arbitrary-amount math.
// This test resolves the ACTUAL transitive import closure with esbuild's real parser + bundler
// (not a hand-rolled regex): esbuild follows static import / export-from, side-effect imports,
// `require(...)` and string `import(...)` — through relative paths and re-export barrels — and
// reports every PARSED input file in its metafile. Forced-invalid fixtures are written to a
// throwaway temp tree and run through the IDENTICAL disk-based bundler, so the same resolver
// judges both the real closure and the negative cases.
//
// The adapter closure is admitted ONLY when the parsed files are the three pure modules, the
// allowed contracts and adapter-local files, and the only bare external is zod. It ALSO scans
// the closure AND the audited pure modules for new I/O / ambient-capability use (the equivalent
// of pinning the reviewed pure files: any such escape fails pending re-audit), and separately
// proves the feature/withdrawals closure never reaches src/server or the dev adapter — including
// via a relative `../../server/…` path or a feature-local barrel that a shallow
// `startsWith('@/server/')` check would miss.

const root = process.cwd();
const ADAPTER_DIR = resolve(root, 'dev/withdrawals');
const FEATURE_DIR = resolve(root, 'src/features/withdrawals');

const ALLOWED_SERVER = new Set([
  'src/server/modules/withdrawals/balance.ts',
  'src/server/modules/withdrawals/readiness.ts',
  'src/server/modules/earnings/money.ts',
]);
const ALLOWED_CONTRACTS = new Set([
  'src/contracts/common.ts',
  'src/contracts/withdrawal.ts',
  'src/contracts/withdrawal-readiness.ts',
  'src/contracts/withdrawal-journey.ts',
]);

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((b) => `node:${b}`)]);
const isBuiltin = (spec: string) => spec.startsWith('node:') || BUILTINS.has(spec);
const isModulePath = (p: string) => /\.[cm]?[jt]sx?$/.test(p);
const norm = (baseRoot: string, absPath: string) => relative(baseRoot, absPath).split(sep).join('/');

// New I/O / ambient-capability use that must not appear in the dev adapter closure or in the
// audited pure modules without an explicit re-audit. The controlled files contain none of these
// tokens (even in comments/strings), so a source scan is sufficient and not brittle here.
const CAPABILITY_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /\bprocess\s*\./, kind: 'process' },
  { re: /\bglobalThis\b/, kind: 'globalThis' },
  { re: /\bfetch\s*\(/, kind: 'fetch' },
  { re: /\bXMLHttpRequest\b/, kind: 'xhr' },
  { re: /\bWebSocket\b/, kind: 'websocket' },
  { re: /\brequire\s*\(/, kind: 'require' },
  { re: /\beval\s*\(/, kind: 'eval' },
  { re: /\bnew\s+Function\b/, kind: 'new_function' },
  { re: /\bimport\s*\.\s*meta\b/, kind: 'import_meta' },
  // A COMPUTED dynamic import — `import(` not immediately followed by a string literal — cannot
  // be statically resolved and is treated as a capability escape in this closure.
  { re: /\bimport\s*\(\s*[^'"\s)]/, kind: 'computed_dynamic_import' },
];
const capabilityViolations = (source: string): string[] =>
  CAPABILITY_PATTERNS.filter((p) => p.re.test(source)).map((p) => p.kind);

const EXT = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'];
function resolveLocal(spec: string, importerAbs: string, baseRoot: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(baseRoot, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(importerAbs), spec);
  else if (spec.startsWith('/')) base = spec;
  else return null; // bare / external specifier
  for (const e of EXT) if (existsSync(base + e)) return base + e;
  return `${base}.ts`; // best-effort; a forbidden path is classified without being read
}

type Reach = 'walk' | 'leaf' | { flag: string };
interface ClosureResult {
  files: string[]; // absolute paths of every PARSED local module
  externals: Set<string>; // bare specifiers (incl. node builtins) reached anywhere
  flagged: { path: string; kind: string }[]; // resolved-but-forbidden edges recorded at resolve time
  errors: string[];
}

// Resolve the transitive closure of `entryPoints` (real files on disk) through esbuild's real
// bundler. `decide` classifies each resolved LOCAL path into walk (parse it), leaf (record but
// don't parse) or a flagged violation. Bare specifiers become recorded externals; esbuild loads
// walked files from disk so its own parser/resolver drives the closure.
async function esbuildClosure(
  entryPoints: string[],
  baseRoot: string,
  decide: (absResolved: string) => Reach,
): Promise<ClosureResult> {
  const externals = new Set<string>();
  const flagged: { path: string; kind: string }[] = [];
  try {
    const result = await build({
      entryPoints,
      bundle: true,
      metafile: true,
      write: false,
      outdir: resolve(baseRoot, '.esbuild-closure-out'), // required for multi-entry; never written
      logLevel: 'silent',
      platform: 'neutral',
      format: 'esm',
      absWorkingDir: baseRoot,
      plugins: [
        {
          name: 'closure',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'entry-point') return undefined; // real path; let esbuild load it
              const spec = args.path;
              if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('/')) {
                externals.add(spec); // bare package or node builtin
                return { path: spec, external: true };
              }
              const resolved = resolveLocal(spec, args.importer, baseRoot);
              if (!resolved || !isModulePath(resolved)) return { path: resolved ?? spec, external: true };
              const reach = decide(resolved);
              if (typeof reach === 'object') {
                flagged.push({ path: resolved, kind: reach.flag });
                return { path: resolved, external: true }; // record, but do not walk further
              }
              if (reach === 'leaf') return { path: resolved, external: true };
              return { path: resolved }; // walk: load exactly this resolved file (default namespace)
            });
          },
        },
      ],
    });
    const files = Object.keys(result.metafile.inputs).map((k) => resolve(baseRoot, k));
    return { files, externals, flagged, errors: [] };
  } catch (e) {
    return { files: [], externals, flagged, errors: [String(e)] };
  }
}

function decideAdapter(baseRoot: string, adapterDir: string) {
  return (abs: string): Reach => {
    const rel = norm(baseRoot, abs);
    if (rel.startsWith('..')) return { flag: 'outside_root' };
    if (rel.startsWith('src/server/')) return ALLOWED_SERVER.has(rel) ? 'walk' : { flag: 'forbidden_server' };
    if (rel.startsWith('src/contracts/')) return ALLOWED_CONTRACTS.has(rel) ? 'walk' : { flag: 'forbidden_src' };
    if (!relative(adapterDir, abs).startsWith('..')) return 'walk'; // adapter-local
    return { flag: 'forbidden_src' };
  };
}
function decideFeature(baseRoot: string, _featureDir: string) {
  return (abs: string): Reach => {
    const rel = norm(baseRoot, abs);
    if (rel.startsWith('src/server/')) return { flag: 'forbidden_server' };
    if (rel.startsWith('dev/')) return { flag: 'forbidden_dev_adapter' };
    // WALK every other local module — feature-local files, shared / other-feature re-export
    // barrels AND contracts — so a forbidden server/dev edge hidden behind a barrel is followed
    // to its real target instead of stopping at the leaf barrel (the round-2 gap: a leaf here let
    // Widget -> @/shared/bridge -> @/server/... report no violation). CSS/asset specifiers are
    // non-module and bare packages are external, so esbuildClosure never walks them regardless.
    return 'walk';
  };
}

function adapterViolations(c: ClosureResult, baseRoot: string, adapterDir: string): string[] {
  const out: string[] = [];
  const decide = decideAdapter(baseRoot, adapterDir);
  for (const f of c.files) {
    const d = decide(f);
    if (typeof d === 'object') out.push(d.flag);
    if (existsSync(f)) for (const k of capabilityViolations(readFileSync(f, 'utf8'))) out.push(`capability:${k}`);
  }
  for (const ext of c.externals) {
    if (isBuiltin(ext)) out.push('node_builtin');
    else if (ext !== 'zod') out.push('forbidden_external');
  }
  out.push(...c.flagged.map((f) => f.kind));
  if (c.errors.length) out.push(`build_error:${c.errors[0]}`);
  return out;
}
function featureViolations(c: ClosureResult): string[] {
  const out: string[] = [];
  for (const ext of c.externals) if (isBuiltin(ext)) out.push('node_builtin');
  // A browser client legitimately uses fetch/WebSocket, so those are NOT flagged here. But a
  // COMPUTED dynamic import (`import(expr)` with a non-literal argument) cannot be statically
  // resolved, so it could hide a forbidden server/dev edge from this very closure. Flag it so an
  // unresolvable-by-design import never silently passes the client boundary. (A string-literal
  // `import('./x')` IS resolved by esbuild and walked/flagged normally.)
  for (const f of c.files)
    if (existsSync(f) && /\bimport\s*\(\s*[^'"\s)]/.test(readFileSync(f, 'utf8')))
      out.push('capability:computed_dynamic_import');
  out.push(...c.flagged.map((f) => f.kind));
  if (c.errors.length) out.push(`build_error:${c.errors[0]}`);
  return out;
}

function walkDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walkDir(resolve(dir, e.name)) : [resolve(dir, e.name)],
  );
}

// Materialise an in-memory fixture graph on disk so it runs through the same disk-based bundler.
const fixtureRoots: string[] = [];
function writeFixture(files: Record<string, string>): string {
  const base = mkdtempSync(resolve(root, '.agent-work/runtime/tmp/wd-boundary-'));
  fixtureRoots.push(base);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = resolve(base, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return base;
}
afterAll(() => {
  for (const dir of fixtureRoots) rmSync(dir, { recursive: true, force: true });
});

// =====================================================================================
// Real dev-adapter closure (esbuild-resolved, syntax-aware)
// =====================================================================================

describe('dev withdrawal adapter import closure', () => {
  const entry = ['transport.ts', 'controller.ts', 'store.ts', 'scenarios.ts'].map((f) =>
    resolve(ADAPTER_DIR, f),
  );

  it('admits exactly the audited pure modules, allowed contracts and zod — nothing else', async () => {
    const c = await esbuildClosure(entry, root, decideAdapter(root, ADAPTER_DIR));
    expect(c.errors).toEqual([]);
    expect(adapterViolations(c, root, ADAPTER_DIR)).toEqual([]);
    expect([...c.externals].sort()).toEqual(['zod']);
    const parsed = new Set(c.files.map((f) => norm(root, f)));
    for (const f of ALLOWED_SERVER) expect(parsed.has(f)).toBe(true);
    for (const rel of parsed) if (rel.startsWith('src/server/')) expect(ALLOWED_SERVER.has(rel)).toBe(true);
  });

  // Reviewed byte-for-byte pins for the three audited pure modules, taken from the frozen WU01
  // baseline manifest (.agent-work/20260916-wu01/baseline.json @ c15353d; sha256 of the raw file
  // bytes, matching scripts/verify-migration-manifest.mjs). A hash pin is a STRICTER re-audit
  // gate than a token scan: it fails on ANY byte change — including an aliased capability such as
  // `const request = fetch; request(...)` that a `\bfetch\s*\(` scan misses — pending a fresh
  // review. The import-closure guard above independently proves these files pull in nothing new.
  const PURE_MODULE_PINS: Record<string, string> = {
    'src/server/modules/withdrawals/balance.ts':
      '9eacf01b49d08361ba6bbadd2f6601e722957759b491f4305109238226deb872',
    'src/server/modules/withdrawals/readiness.ts':
      'e10ee45c4a37e17692239393cff47053e2593d6078198cf037b44ab75c262a9f',
    'src/server/modules/earnings/money.ts':
      '44a7dad0a7a13177847066ddd48b979c807d9c8d965e52f3717c46d04dbf5a15',
  };

  it('pins the three audited pure modules to their reviewed baseline bytes (re-audit pin)', () => {
    // The pin set and the walk allow-list must describe the same three files.
    expect(new Set(Object.keys(PURE_MODULE_PINS))).toEqual(ALLOWED_SERVER);
    for (const [rel, expected] of Object.entries(PURE_MODULE_PINS)) {
      const actual = createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
      expect(actual, `${rel} changed from its reviewed baseline; re-audit and re-pin`).toBe(expected);
    }
  });
});

// Detect a native browser ('use client') root: the directive must be the first statement, after
// only leading comments/blank lines (matches how the bundler recognises it).
function isUseClientRoot(file: string): boolean {
  const src = readFileSync(file, 'utf8');
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(src);
}

// =====================================================================================
// Feature closure must never reach a server module or the dev adapter (real files)
// =====================================================================================

describe('feature withdrawals closure never reaches server or the dev adapter', () => {
  it('no feature/withdrawals file transitively imports @/server, ../server or dev/', async () => {
    const entry = walkDir(FEATURE_DIR).filter((p) => /\.[cm]?tsx?$/.test(p));
    expect(entry.length).toBeGreaterThan(0); // model exists today; Astra UI files are covered too
    const c = await esbuildClosure(entry, root, decideFeature(root, FEATURE_DIR));
    expect(c.errors).toEqual([]);
    expect(featureViolations(c)).toEqual([]);
  });

  // The original F07/plan requires the ACTUAL native browser roots to be checked, not only the
  // withdrawals feature barrel. Enumerate EVERY source module under app/ and src/ whose leading
  // directive (after only comments/blank lines) is 'use client' — that is exactly the set the
  // bundler ships to the browser. API route handlers and React Server Components carry no such
  // directive, so they are naturally (and deliberately) NOT scanned here (they are allowed to
  // reach the server). Resolve the closure of ALL of these real client roots through the SAME
  // walking guard and deny any server/dev edge. Scoping this to walkDir(FEATURE_DIR) — the
  // round-3 gap — covered only the two withdrawals clients and let the other ~54 roots go
  // unchecked; the representative + count assertions below make that narrowing fail loudly.
  const SOURCE_ROOTS = ['app', 'src'].map((d) => resolve(root, d));
  const allUseClientRoots = (): string[] =>
    SOURCE_ROOTS.flatMap(walkDir).filter((p) => /\.[cm]?tsx?$/.test(p) && isUseClientRoot(p));

  it("every native 'use client' browser root (app + src) has a server/adapter-free closure", async () => {
    const clientRoots = allUseClientRoots();
    const relRoots = new Set(clientRoots.map((f) => norm(root, f)));

    // Representative native roots from across the app must be enumerated, so accidentally
    // reverting this to the withdrawals-feature-only set can no longer pass.
    for (const rep of [
      'src/features/partner-application/PartnerApplication.tsx',
      'src/features/overview/OverviewPage.tsx',
      'src/features/staff-finance/StaffFinanceConsole.tsx',
      'src/features/withdrawals/WithdrawalExperience.tsx',
    ]) {
      expect(relRoots.has(rep), `${rep} must be enumerated as a native 'use client' root`).toBe(true);
    }
    // The full app+src set is far larger than the two withdrawals clients; guard against silent
    // scope collapse (56 roots today; floor kept well below to tolerate churn but above 2).
    expect(clientRoots.length).toBeGreaterThanOrEqual(40);

    const c = await esbuildClosure(clientRoots, root, decideFeature(root, FEATURE_DIR));
    expect(c.errors).toEqual([]);
    expect(featureViolations(c)).toEqual([]);
  });
});

// =====================================================================================
// Forced-invalid fixture graphs (same disk-based bundler; written to a throwaway temp tree)
// =====================================================================================

describe('closure analyzer rejects forbidden edges (temp-file fixtures)', () => {
  it('flags a Node builtin, a non-audited server edge and a private runtime edge via re-export', async () => {
    const base = writeFixture({
      // A re-export barrel and a require() call — both followed by esbuild, not a regex.
      'dev/withdrawals/a.ts': `export * from './b';\nimport 'node:fs';\nconst s = require('@/server/modules/statements/settle');\nexport const A = s;`,
      'dev/withdrawals/b.ts': `import { z } from 'zod';\nimport keys from '@/shared/query/keys';\nexport const B = { z, keys };`,
    });
    const c = await esbuildClosure([resolve(base, 'dev/withdrawals/a.ts')], base, decideAdapter(base, resolve(base, 'dev/withdrawals')));
    const kinds = adapterViolations(c, base, resolve(base, 'dev/withdrawals'));
    expect(kinds).toContain('node_builtin');
    expect(kinds).toContain('forbidden_server'); // statements/settle is not audited-pure
    expect(kinds).toContain('forbidden_src'); // shared/query/keys is runtime/private
    expect([...c.externals]).toContain('zod');
  });

  it('flags a computed dynamic import and a direct capability use in the adapter closure', async () => {
    const base = writeFixture({
      'dev/withdrawals/a.ts': `const p = 'node:fs';\nexport async function go() { await import(p); const e = process.env.SECRET; await fetch('https://x'); return e; }`,
    });
    const c = await esbuildClosure([resolve(base, 'dev/withdrawals/a.ts')], base, decideAdapter(base, resolve(base, 'dev/withdrawals')));
    const kinds = adapterViolations(c, base, resolve(base, 'dev/withdrawals'));
    expect(kinds).toContain('capability:computed_dynamic_import');
    expect(kinds).toContain('capability:process');
    expect(kinds).toContain('capability:fetch');
  });

  it('flags a forbidden bare external (e.g. a network/fs client)', async () => {
    const base = writeFixture({ 'dev/withdrawals/a.ts': `import c from 'node-fetch';\nexport const A = c;` });
    const c = await esbuildClosure([resolve(base, 'dev/withdrawals/a.ts')], base, decideAdapter(base, resolve(base, 'dev/withdrawals')));
    expect(adapterViolations(c, base, resolve(base, 'dev/withdrawals'))).toContain('forbidden_external');
  });

  it('accepts a graph limited to the audited pure module + contracts + zod', async () => {
    const base = writeFixture({
      'dev/withdrawals/a.ts': `import { computeWithdrawable } from '@/server/modules/withdrawals/balance';\nimport { z } from 'zod';\nimport { WithdrawalScope } from '@/contracts/withdrawal-journey';\nexport const A = { computeWithdrawable, z, WithdrawalScope };`,
      'src/server/modules/withdrawals/balance.ts': 'export const computeWithdrawable = 0;',
      'src/contracts/withdrawal-journey.ts': 'export const WithdrawalScope = 0;',
    });
    const c = await esbuildClosure([resolve(base, 'dev/withdrawals/a.ts')], base, decideAdapter(base, resolve(base, 'dev/withdrawals')));
    expect(adapterViolations(c, base, resolve(base, 'dev/withdrawals'))).toEqual([]);
    expect([...c.externals]).toEqual(['zod']);
  });

  it('rejects a FEATURE file that reaches a server module by relative path or a local barrel', async () => {
    const base = writeFixture({
      // Neither edge uses the literal `@/server/` prefix a shallow check looks for: one is a
      // relative escape, the other hides behind a feature-local barrel re-export.
      'src/features/withdrawals/Widget.tsx': `import './barrel';\nimport x from '../../server/modules/withdrawals/balance';\nexport const W = x;`,
      'src/features/withdrawals/barrel.ts': `export * from '../../server/modules/earnings/money';`,
      'src/server/modules/withdrawals/balance.ts': `export const balance = 1;`,
      'src/server/modules/earnings/money.ts': `export const money = 1;`,
    });
    const c = await esbuildClosure(
      [resolve(base, 'src/features/withdrawals/Widget.tsx')],
      base,
      decideFeature(base, resolve(base, 'src/features/withdrawals')),
    );
    const kinds = featureViolations(c);
    expect(kinds.filter((k) => k === 'forbidden_server').length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a FEATURE file that imports the dev adapter', async () => {
    const base = writeFixture({
      'src/features/withdrawals/Widget.tsx': `import { c } from '../../../dev/withdrawals/controller';\nexport const W = c;`,
      'dev/withdrawals/controller.ts': `export const c = 1;`,
    });
    const c = await esbuildClosure(
      [resolve(base, 'src/features/withdrawals/Widget.tsx')],
      base,
      decideFeature(base, resolve(base, 'src/features/withdrawals')),
    );
    expect(featureViolations(c)).toContain('forbidden_dev_adapter');
  });

  // Exactly the root round-2 boundary probe: Widget -> @/shared/bridge -> @/server/.../balance.
  // The old leaf-at-first-non-feature rule reported violations=[] here (only Widget parsed); the
  // walking rule follows the shared barrel to its real server target and flags it.
  it('rejects a FEATURE file reaching a server module THROUGH a shared re-export barrel', async () => {
    const base = writeFixture({
      'src/features/withdrawals/Widget.tsx': `import { value } from '@/shared/bridge';\nexport const W = value;`,
      'src/shared/bridge.ts': `export { value } from '@/server/modules/withdrawals/balance';`,
      'src/server/modules/withdrawals/balance.ts': `export const value = 1;`,
    });
    const c = await esbuildClosure(
      [resolve(base, 'src/features/withdrawals/Widget.tsx')],
      base,
      decideFeature(base, resolve(base, 'src/features/withdrawals')),
    );
    // The shared barrel is now PARSED (walked), not treated as an opaque leaf.
    expect(c.files.map((f) => norm(base, f))).toContain('src/shared/bridge.ts');
    expect(featureViolations(c)).toContain('forbidden_server');
  });

  // A native 'use client' root may never reach an AUDITED PURE server module either: the three
  // pure modules are an exception the dev ADAPTER may import, never the browser client.
  it("rejects a native 'use client' root that reaches an audited pure server module", async () => {
    const base = writeFixture({
      'src/features/withdrawals/ClientRoot.tsx': `'use client';\nimport { computeWithdrawable } from '@/server/modules/withdrawals/balance';\nexport const C = computeWithdrawable;`,
      'src/server/modules/withdrawals/balance.ts': `export const computeWithdrawable = 1;`,
    });
    expect(isUseClientRoot(resolve(base, 'src/features/withdrawals/ClientRoot.tsx'))).toBe(true);
    const c = await esbuildClosure(
      [resolve(base, 'src/features/withdrawals/ClientRoot.tsx')],
      base,
      decideFeature(base, resolve(base, 'src/features/withdrawals')),
    );
    expect(featureViolations(c)).toContain('forbidden_server');
  });

  // Computed / unresolvable local imports must not silently pass the client closure: an
  // unresolvable import is a build error, and a computed dynamic import is flagged (it could
  // otherwise hide a forbidden edge from the static walk).
  it('does not silently pass an unresolvable local import in a client closure', async () => {
    const base = writeFixture({
      'src/features/withdrawals/Widget.tsx': `import x from './does-not-exist';\nexport const W = x;`,
    });
    const c = await esbuildClosure(
      [resolve(base, 'src/features/withdrawals/Widget.tsx')],
      base,
      decideFeature(base, resolve(base, 'src/features/withdrawals')),
    );
    expect(c.errors.length).toBeGreaterThan(0);
    expect(featureViolations(c).some((k) => k.startsWith('build_error:'))).toBe(true);
  });

  it('flags a computed dynamic import in a client closure', async () => {
    const base = writeFixture({
      'src/features/withdrawals/Widget.tsx': `const p = './x';\nexport async function go() { return import(p); }`,
    });
    const c = await esbuildClosure(
      [resolve(base, 'src/features/withdrawals/Widget.tsx')],
      base,
      decideFeature(base, resolve(base, 'src/features/withdrawals')),
    );
    expect(featureViolations(c)).toContain('capability:computed_dynamic_import');
  });
});
