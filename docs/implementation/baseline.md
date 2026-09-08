# Implementation baseline — F00

Recorded 2026-09-08. This is a local implementation checkpoint, not a deployed release.

## Repository and runtime

- Original reviewed documents and `design-preview/` were checkpointed in local `main` at `7bcab48` before application changes.
- Implementation branch: `feat/portal-foundation`, single checkout, solo author. No agents were dispatched.
- No Git remote, branch protection, hosted CI execution, deployed SHA, deployment ID or production artifact is established. F00's remote/protection gate remains open. Do not infer that local main is production.
- Original preview: `node design-preview/server.mjs`, localhost 4186. Twenty baseline file hashes matched after implementation. A stopped original listener was restarted without changing its source.
- New application: `npm run dev`, localhost 4187. Development gallery: `/foundation`. Production check server: `npm run start`, localhost 4188 after a build.
- Internal work, caches and evidence are ignored under `.agent-work/`. They must not enter a commit. No credentials, upstream data pulls, database creation, migrations or deployment were performed.

## Pinned stack

Use `.nvmrc` (Node 24.18.0) and npm 11.16.0. `package-lock.json` is the installation authority; use `npm ci`. On this Mac the tested executable is `/opt/homebrew/opt/node@24/bin/node`; system Node 26 is outside the declared engine.

| Area | Installed choice | Responsibility |
|---|---|---|
| App | Next 16.3.4, React 19.2.8, TypeScript 7.0.2 | Server route shell and interactive React components |
| Contracts | Zod 4.5.4 | Strict shared wire validation, including exact integer-string money |
| Client data | TanStack Query 5.102.8 | Scoped memory cache and selective revision invalidation |
| Styling | CSS Modules, semantic CSS tokens, Lucide 1.42.0 | Existing Day/Dark identity and reusable primitives |
| Fonts | Self-hosted Inter, DM Sans, Noto Sans Thai | No runtime Google Fonts request |
| Future store | Drizzle 0.45.2, postgres 3.4.9 | Dependencies present; no database connection or schema deployed |
| Verification | Vitest 5, Testing Library, Playwright 1.63 | Unit/contracts and browser journey scaffolding |
| Formatting | Prettier 3.9.6 | Readable source, no reformatted legacy preview |

The chosen Next subset follows the reviewed plan: explicit future REST reads for money, one client query owner, no competing financial Server Action path. Better Auth is intentionally not installed before the A01 provider proof. ERP, Sale Dashboard and ChatMesh remain independent source systems behind future adapters.

## Commands and isolation

`dev`, `start`, `build`, `typecheck`, `test` and `verify:no-demo` run through `scripts/run.mjs`. It sets project-local temporary/cache paths and disables Next telemetry. `.npmrc` keeps npm's cache local. `agentRules: false` prevents Next dev from appending generated instructions to the user's AGENTS.md.

`test:e2e` has three authored foundation journeys. They are not reported as a Playwright runner pass in this checkpoint; rendered checks used the authorized in-app browser runtime. Integration/performance/migration/import scripts deliberately exit nonzero with a task dependency explanation until their later implementations exist. Empty suites are not passing gates.

Production denies `/foundation` with 404. A phase-specific Turbopack alias also replaces its gallery module so demo code is not merely hidden behind a route condition. Build checks reject demo flags and scan emitted browser JavaScript for development fixture markers. This guards the current fixture path; it is not an authentication or information-flow security audit. The root production page contains only a preparation message, not mock login or financial reports.

## Assets and rights

Eight existing project images were copied unchanged into `public/media/`: profile avatar, profile cover and six supplied clip covers. Cover cropping uses CSS 9:16 with per-image positioning; no image generation or pixel editing occurred. The user supplied these assets for the local design. Public redistribution/licensing has not been independently established. Original references under `_Reff/` remain ignored and are not bundled.

Background music is an optional isolated HTMLAudio adapter. No licensed audio source is configured in the gallery, so its control explains that it is unavailable. An enabled intent is not evidence of audible autoplay. The existing YouTube prototype remains untouched.

## Checks and remaining gates

Clean `npm ci` succeeded; audit reported zero vulnerabilities for 141 packages at this checkpoint. Typecheck, 34 tests in seven files, production guard and build passed after clean install. A forced `DEMO_DATA=1` guard run exited 1 as intended. Final production HTTP checks and browser observations are recorded in [foundation-validation.md](foundation-validation.md).

The workflow file is authored, not remotely executed. Required before merge/release: independent different-model review of a frozen candidate, actual remote/protected-main setup and CI enforcement. Real OAuth, source reconciliation, DB isolation and load/latency proof belong to later tasks. The historical Opus plan review does not review this code.

Fresh-source check: `typecheck` runs `next typegen` before `tsc --noEmit`, following the installed Next documentation. `next-env.d.ts` is generated and ignored so switching dev/build does not dirty the branch. An isolated project-local source copy with no `.next` or generated env file passed this command; it reused the freshly installed dependency directory, not generated route types.
