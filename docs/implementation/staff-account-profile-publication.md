# Publish an agreed partner account profile

The team agrees the deal before inviting the celebrity. In `/ops/access`, select an active partner, enter the prepared agreement reference, choose **เปิดตรวจข้อตกลง**, check the partner, terms, dates, source version, evidence reference and support channel, then **นำข้อตกลงขึ้นแสดง** and confirm. Publication updates the partner's `/account` display. It never recalculates commission, modifies a statement, or records a payment.

## Source and configuration

`LABSD_ACCOUNT_PROFILE_ENABLED=1` exposes the staff card and endpoints. It defaults off. Identity must be configured and namespace-bound; the staff account requires `manage_partners`. The publish operation also requires recent authentication. `LABSD_REVIEW_DIRECTORY` must be an absolute, operator-provisioned read-only directory. Store an already agreed `AccountProfile` JSON at `account-profiles/<reference>.json`; reference is a safe record ID, not a filesystem path. The application never uploads or edits that source. Do not place credentials in it. Schema: `src/contracts/account-profile.ts`. A future authenticated ERP/API adapter can implement the same `AccountProfileRepository.load(partnerId, reviewId)` contract without changing the account UI or publisher.

The server reuses the reviewed-file reader's bounded regular-file, UTF-8, symlink and change checks. Missing, invalid or wrong-partner source fails closed; configuration alone does not invent a profile. The operator who provisions this source is responsible for confirming that it reflects the agreed deal. This is a display publication step, not a second finance approval or a contract editor.

## API and consistency

- `POST /api/v1/staff/account-profiles/inspect` accepts only `partnerId` and `reviewId`. It checks staff authorization before loading the source and again before returning its validated snapshot, digest and current published revision. Inspect is read-only.
- `POST /api/v1/staff/account-profiles/publish` accepts those identifiers plus `expectedDigest`, `expectedRevision` and `idempotencyKey`. Browser-supplied terms or snapshots are rejected. The existing publisher reloads the source, checks digest/scope, rechecks fresh authorization and atomically writes the profile with an audit receipt. Retry uses the same command key. Concurrent or stale publication returns conflict.
- Same-origin JSON POSTs only, bounded request bodies, no-store responses. Disabled route returns404. Invalid source returns unavailable without source details. Revoked staff and inactive partners cannot publish.
- Changing partner or reference clears the UI review; late/aborted responses cannot replace the current review. A confirmation receipt must match the selected partner and next revision.
- Null agreement explicitly clears the displayed agreement and is highlighted in the review. Null support URL uses the existing coordination channel; no contact URL is inferred.

Published profiles use migration0027 from the earlier account batch; no new migration is required. Native account reads already refresh through its query lifecycle; this batch adds no realtime account event stream. Disabling the feature removes staff publication access but preserves existing displayed profiles and financial data. Rollback code independently of retained profile records.

## Local acceptance

Synthetic sources and isolated PostgreSQL are used for development acceptance. Live source provisioning, production exposure and real deal validation remain separate deployment work. Local tests cover inspect without write, publish/replay/audit, stale source, invalid/foreign source, authorization revocation, fresh login, origin/body guards, and UI review/confirmation scope. See the project context handoff for actual run results and remaining visual/browser acceptance.
