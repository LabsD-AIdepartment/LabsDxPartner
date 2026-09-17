# Labs D x Partner

## Run locally

Use Node24, then run `npm run dev` from this directory.

Open **https://127.0.0.1:4443/login**. This is the single local application running
the current `main` checkout, with the native identity database enabled.

Local configuration and the existing TLS certificate live in ignored `.local/`.
See [local runtime](docs/implementation/local-runtime.md) for setup and boundaries.
Do not start historical `.agent-work` preview scripts or old copied builds.

## Check changes

`npm test` runs unit/contract tests. `npm run typecheck` checks the full TypeScript
program. The development preview routes are disabled by default and in production builds; their
synthetic trial accounts are not native login accounts.

## Current integration state

The accepted working files were preserved when consolidating onto local `main`.
There is currently no configured Git remote. Uncommitted working changes are not
a production release; a reviewed commit and deployment receipt are required
before claiming that the latest design is deployed.
