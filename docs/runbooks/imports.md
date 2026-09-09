# Reviewed-file import operations

This is the first configured acquisition path. It consumes an existing detailed approved-period export; it is not a general CSV mapper, order connector, payment gateway or summary-only importer. Native source-review UI and scheduled automation remain separate work. Normal import never creates or approves its own business inputs.

## Source responsibility and setup

The source team supplies detailed entitlement rows using `approved-period/1`. Finance independently supplies the matching `ApprovalContext`: coverage/control totals, agreement rules, canonical source references, evidence and the exact export SHA-256. Do not calculate those controls from the uploaded rows as a substitute for source reconciliation. A source that cannot supply this detail needs its own explicitly supported contract; do not invent clip/order rows.

Configure one absolute `LABSD_REVIEW_DIRECTORY` on the selected worker. Provision it through the existing operator/deployment process and mount it read-only to portal runtimes:

```text
<review-root>/
  exports/<review-id>.json
  controls/<review-id>.json
  catalogues/<review-id>.json
  settlements/<record-id>.json
```

Exports and controls have different source owners/write permissions. The portal has no browser upload/write route to this directory. Catalogue and settlement documents are already-reviewed records consumed by their existing owning services; this import command only processes income periods. Use stable review IDs containing letters, numbers, `_` or `-`, starting with a letter/number, at most128characters. UUIDs work. The adapter derives filenames; request paths, extensions, symlink files/directories and nonregular files are rejected. Each file is bounded by the existing16MiB intake limit and decoded as valid UTF-8; changed files are rejected. File naming, format validation or read-only mounting alone does not prove business approval.

Provision complete files atomically. Preserve the export bytes after review. If either file changes, obtain a new authenticated review of that exact pair; do not rewrite an immutable approval or edit a closed statement. An approval must first exist through `createApprovalStore.approve` under a fresh authorized staff session. Its exact digest and independent controls are stored in PostgreSQL. Native source-review screen wiring is still pending; direct database insertion is not the operator approval workflow.

## Run a single approved import

Inject the existing credential namespace configuration (`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`) into the selected worker, plus `LABSD_REVIEW_DIRECTORY` and explicit `LABSD_IMPORT_ENABLED=1`. Do not put secrets into command arguments or logs. The namespace binding must already match; this command never provisions or changes it. Record `LABSD_RELEASE_SHA` for release runs after verifying the built artifact. Web and import artifacts must belong to the same known release when deployed.

From the project root with the pinned Node24 runtime:

```sh
npm run import:once -- --approval-id <approved-uuid> --idempotency-key <stable-attempt-id>
```

Use the same attempt ID for a retry of the same command. Unknown/duplicate/missing arguments are rejected. The separate worker pool has at most2connections and closes on completion; the CLI does not borrow the web pool or start a background process. It loads the immutable approval, acquires only its named files, verifies the exact review digest, and rechecks approval revocation after acquisition. Existing runner fencing, overlap/correction checks, exact-money validation and atomic generation selection apply. A ready result is an internal reconciled generation, not an issued statement or payment. Staff publishes separately through `/ops/periods`.

Output is bounded JSON containing correlation ID, optional recorded release SHA, approval/partner/run identifiers, state, replay flag and issue count. Errors expose a stable code, not file contents, filenames, database URLs or provider stacks. Exit0 means ready; exit2 means a returned nonready terminal state; exit1 means the command could not complete. Check both the exit status and recorded run state.

## Failure and recovery

| Result | Operator action |
|---|---|
| `forbidden` | Check the import flag, selected namespace binding and whether the approval still exists and is not revoked. Do not create a grant or new approval implicitly. |
| `unavailable` | Check the configured read-only mount, file presence/permissions and selected database availability. Keep secrets out of diagnostic output. |
| `invalid_input` / `too_large` | Correct the source contract or selected arguments. Acquire a new review if business input bytes change. |
| `changed` / `conflict` | Stop using the old reviewed pair. Inspect source revision/digest and current generation; do not overwrite history. |
| `busy` | Another scope run owns the lease. Observe that run before retrying; do not kill/restart based only on an elapsed wait. |
| `superseded` | Inspect the current approval/run. A crashed attempt returns terminal superseded after its expired lease; use a new attempt ID only after confirming the same approval remains the intended current source. |
| `closed_period` / `overlapping_period` | Review period selection and append-only correction policy. Do not reopen or delete an issued statement. |
| nonready returned state | Inspect the internal run issues before any publication. Unresolved or invalid data is not confirmed income. |

Missing/changed acquisition fails before a new import commit and preserves the prior good generation. Acquisition failures currently appear in the worker result; recording source-health history and exposing it in the staff intake page remain follow-up work. The existing partner data-through time stays attached to its published source; do not claim a newer upstream refresh from a successful page load.

The old `npm run import:once -- --synthetic` command remains an explicit developer trial, restricted to the project-owned isolated test cluster. It is never selected on configuration failure and is not a production approval mechanism. No scheduler or production import flag is enabled by this change. Production configuration, mounts, grants, migrations or exposure require their own authorized release process.
