# Authenticated partner application composition

2026-09-09 · D030 · Local candidate, following invitation-first D025 and guarded entry D029.

## Result and boundaries

The seven private partner leaves now resolve maintained native identity and current database memberships instead of unconditionally redirecting to login. An expired session returns to the safe login destination. Disabled or failing identity goes to the retry access screen; valid accounts without a partner/menu grant can still reach account/logout and see an access explanation. There is no second commercial approval after invitation redemption.

A shared PartnerApplication composes the existing Overview, ContentList, ContentDetail, AdDetail, StatementList and StatementDetail components. Existing three-menu shell/theme/type tokens and ready views remain. The real account route uses CredentialAccount: current-password change through the guarded existing service, support explanation and logout. Historical social-management preview components remain unmounted from this route; the pending D023 staff/preview reconciliation remains separate.

The runtime defaults report periods to the current Bangkok month. Content reset can receive that runtime default rather than restoring fixture dates. Optional partner images retain shared image geometry; no fixture celebrity is assigned to a real account. PartnerIdentity is extracted unchanged from the ready earnings card and shared with an explicit unavailable overview. Unknown amounts remain null/dashes and unknown graphs have no fabricated series.

**Financial reads are still unconnected.** The production composition injects a SourceUnavailableError transport; it makes no financial API call, returns no fake generation/freshness/zero and imports no development fixtures. This batch does not implement source query authorization, clip identity lookup or financial projection reads. Those are required in G02–G04 with exact user/partner/capability/revision checks at the server boundary. Existing feature response validation remains in place for that future adapter. No claims about query speed, real earnings or end-to-end realtime follow from this batch.

## Session and cache behavior

`GET /api/partner/session` resolves a current database session and current memberships. `POST` on the same route accepts only a partner ID, exact configured Origin and JSON; bounded input is read before service invocation. It rejects selecting another partner without active membership. Responses are private/no-store and suppress referrers. The route wrapper checks the credential namespace binding before either action. Unknown runtime failures remain generic503. Capacity/admission testing of the read path is still open.

`__Host-labsd-partner` is a Secure/HttpOnly/SameSite=Lax session cookie containing a user-bound selection preference. It grants no access. Every session read validates the preference against that user's current active memberships; malformed/foreign/stale selections are ignored for initial selection. Future financial requests must reject a mismatched explicit scope rather than adopting this fallback. Successful native logout also expires the preference.

The client verifies access on entry, every30seconds while visible and on visibility/pageshow transitions. It removes the feature subtree while checking after returning to the page, when switching/logging out, or when verification fails. ScopedQueryProvider cancellation/clear follows unmount; user/partner/revision keys isolate replacement caches. Switching and successful logout use full navigation. An in-flight verification cannot restore private feature UI during a mutation; aborted older checks cannot override a newer response. Password change returns to login only after the server confirms replacement/session revocation. The30second check is an access refresh interval, not an instant-revocation or financial realtime SLA.

## Author verification

Evidence directory: `.agent-work/20260909-partner-session/evidence/`.

- `unit-full-02.log`:202/202 across20files. New application tests cover unavailable overview geometry/no fixture money, hidden-page removal and recheck failure, valid accounts without menu grants, literal password change and invalid/foreign selection preferences. Updated former deny-only gate tests cover valid maintained sessions, expired login routing and disabled/binding-failure behavior.
- `integration-full-01.log`:88/88 across8files using the project-owned PostgreSQL55487 instance. Added native invite/register/login -> owned-partner selection -> existing-account invitation acceptance -> another-user preference rejection -> staff suspension -> old-session denial -> native logout/session rejection. No fake principal for that journey.
- `typecheck-03.log` and `build-01.log` pass, including production fixture exclusion. `git diff --check` passes.
- Initial focused tests caught a composition error: passing a full report context to the strict Overview filter schema. The composition now projects only from/toExclusive/brand. The new test also initially supplied an extra idempotency field to the strict existing invitation-accept contract; the test now uses the actual token-only contract. Full testing then exposed the obsolete synchronous always-deny gate assertions; those were replaced with async authenticated-boundary assertions.
- Read-only local HTTP checks: identity remains disabled/unconfigured at4187; `/overview`307 redirects to access/retry, and `/api/partner/session`503 reports generic identity unavailable. This proves denial behavior only. Listener82055 was verified in the current checkout.
- Real browser invitation/login/application/logout/recovery, HTTPS provisioning, hydration/responsive/200%zoom and independent release acceptance remain OPEN. Prior browser URL-policy failure was not bypassed. Component tests and HTTP status checks are not browser acceptance.

No migration added or modified. Isolated PostgreSQL55487 was stopped after testing; managed5432 was untouched. No real recipient/account conversion, invitations sent, upstream reads/writes, deployment, merge/push or independent reviewer acceptance.

## Next work

Reconcile the minimal staff issue/revoke/reissue/reset UI and staff provisioning/recovery runbook with D025. Establish a controlled HTTPS runtime and supported browser surface to verify the full user journey. Source-read adapter work must wait for the selected real source contract and then prove exact scope/capability/revision, unavailable-versus-zero behavior and reconciliation against the source. A03 is a local application candidate, not completed release acceptance; all original phase gates remain.
