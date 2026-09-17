# Database backup and isolated recovery

The local drill is available now. It proves a logical PostgreSQL backup can recreate the current synthetic database in fresh isolated databases. It is not a production backup service, an in-place restore command, a cutover procedure or an off-device disaster-recovery guarantee.

## Run the local drill

Use Node 24 and PostgreSQL 17 tools. From the project root:

```sh
LABSD_TEST_DATABASE_URL=postgresql://labsd_test@127.0.0.1:55487/labsd_partner_test \
LABSD_PG_BIN=/opt/homebrew/opt/postgresql@17/bin \
/opt/homebrew/opt/node@24/bin/node scripts/restore-drill.mjs
```

The command accepts no arguments and never accepts a restore destination. It refuses other hosts, ports, source database names, users, passwords, URL options and fragments. The database must confirm that its physical cluster is in this project's `.agent-work` area; any nondefault tablespace must also resolve there. The script checks PostgreSQL server/tool major versions. Libpq tools receive explicit local connection settings without inherited service/password/options overrides or interactive password prompts.

Each run creates a private, unique `.agent-work/restore-<timestamp>-<uuid>/` directory and generates two `labsd_restore_<uuid>` database names. One receives the complete archive; the other receives only independently captured source schema. Creation refuses collisions and verifies the selected target is empty. No `DROP`, `--clean`, in-place overwrite, source migration, owner server restart, API call or source-data update is performed. An unsuccessful run retains its archive, diagnostics and newly created databases for inspection; the script never silently cleans them up or reuses them.

The work directory is mode 0700; artifacts are mode 0600. The archive contains synthetic identity/session data and must still be treated as private. Tools write stderr only inside that directory: do not paste their logs or dump contents into chat. The console emits table names/counts and a bounded result. The command exits nonzero on a failed check. `result.json` records the failed stage and a bounded diagnostic when available; a failed run is never backup acceptance.

## What is verified

1. Export a PostgreSQL snapshot inside one repeatable-read, read-only transaction. The custom-format archive, independent schema export and source row verification all use that same snapshot. Source reads use UTC consistently.
2. Hash **every value of every row in every ordinary user table**, using SHA-256 row hashes sorted with C collation and streamed in bounded batches. Counts and duplicate multiplicity are preserved. Per-table digests stay in process memory; reports contain equality results, not identity/credential values or their digests. Partitioned tables, foreign tables and materialized views currently fail closed and need an explicit extension before they can be accepted.
3. Compare all sequence values and `is_called` states. Sequences are not MVCC snapshots, so the drill verifies they did not change during capture. If a source writer advances one during backup/verification, keep the failed evidence and rerun a fresh drill after that writer has finished; do not stop or modify the owner's runtime automatically.
4. Check every applied migration checksum against its source file. After restore, full-table equality also checks the migration ledger, financial history, audit, catalogues, registrations, immutable platform observations and pending worker state.
5. Restore with `pg_restore --single-transaction --exit-on-error` into the new empty database. Compare every table, row count, row value and sequence against the captured source.
6. Reparse the independent source-schema SQL in the second empty database with `psql -X --single-transaction --set=ON_ERROR_STOP=1`. Dump that schema and compare it with the full restore's schema, ignoring only pg_dump's random psql restriction nonce. This preserves checks, functions, triggers, indexes and foreign keys while accommodating PostgreSQL's parser normalization of associative expressions. SQL parentheses or constraint bodies are never removed by a text-matching workaround.
7. Attempt a no-op update of an issued statement in a transaction. The restored immutable-finance trigger must reject it with the exact expected exception. No statement is altered.

All logical schema comparisons deliberately exclude ownership and grants (`--no-owner --no-privileges`). Roles, role secrets and effective production permissions require separate controlled provisioning and acceptance. This drill never starts restored workers. Their old pending jobs, leases and provider bindings remain data, not authorization to execute acquisition. A separate [native application recovery check](../implementation/restored-app-acceptance.md) now tests the existing synthetic login, membership, reports, account agreement, CSV export and logout against the restored target without rebinding identity or opening a new service.

## Evidence and limits

The successful 2026-09-11 run compared 55 tables containing 444,820 rows, 27 applied migrations and two sequences. All row comparisons, reparsed schema comparison and immutable-statement rejection passed. Total local elapsed time was about 22.05 seconds. Six boundary unit cases also passed, covering source rejection, project containment, generated target names, environment isolation, schema-difference preservation and refusal of a supplied target before creating artifacts. Full TypeScript checking passed.

These figures concern the current synthetic local database and local SSD. They are not a promised production RTO. The recorded exported snapshot is the recovery point for transactional rows; do not interpret dump completion time as the last recovered business transaction. The existing live preview stays on its original database. The separate native-route check has passed for the existing synthetic binding; full built-service cold start/browser acceptance, production roles, remote backup retrieval, point-in-time recovery and a full device-loss drill remain separate work.

## Before real operation

- Agree the required RPO (acceptable missing writes) and RTO (acceptable downtime) with the Labs D owner. Record the backup schedule, failure/age alert recipient and recovery operator against those needs rather than inventing retention durations.
- Configure managed backups/PITR and a protected off-device copy on the chosen deployment service. Verify actual retrieval into an isolated environment. Local archives on the same SSD do not protect against losing that device.
- Include required files outside PostgreSQL: reviewed source exports/controls, catalogue inputs, settlement/payment evidence, private documents, uploaded media and the versioned app/worker artifacts. Back up content itself where needed, not only a database URL or reference. Keys and namespace secrets belong in a separate authorized secret-management recovery process.
- Define retention/legal holds for issued statements, source evidence, audit and immutable platform reports. Until a policy is approved, this tool performs no deletion. Local drill copies also accumulate; remove a specifically identified retired drill database/archive only under the applicable cleanup authorization, never the original source.
- For a real incident: establish the incident and source write state, preserve evidence, identify the recovery point and missing writes, restore into a new isolated target, validate schema/data/application/permissions and source reconciliation, then obtain owner approval for cutover. Keep imports, platform calls, notifications and partner exposure off until their exact bindings and release artifact are verified. Code rollback does not roll back data.

Production deployment, production recovery/cutover and deletion remain independently authorized operations. The local drill does not grant any of them.


### Built application on the restored database

The [application recovery acceptance](../implementation/restored-app-acceptance.md#built-service-http-recovery-acceptance) now has an isolated built-service HTTP mode. It exercises the same restored account, financial totals, statements and isolation through the actual built Next router, and checks five HTML pages and referenced local assets. It uses a temporary loopback port and preserves the original logical identity origin. It does not replace the active preview or prove TLS/browser cutover, different-origin identity migration, every media file or off-device disaster recovery.
