# Invitation-only account activation

2026-09-09 · D-025 · Owner-directed replacement of social-first access.

## Product flow

1. LabsD completes the commercial agreement outside the portal.
2. Authorized staff select the existing partner, verified recipient/contact and permitted access, then create an invitation. A manager receives their own invitation/account; no shared celebrity password.
3. Staff send the invitation through the established contact channel. Sending remains a deliberate staff action; the portal need not introduce a messaging service.
4. Recipient opens the link, sees the invitation context and chooses username, password and password confirmation. No Google/LINE/Apple account or public sign-up is required.
5. Successful redemption activates the preapproved membership and starts the authenticated session. Routine activation does not require staff to approve the same deal twice.
6. Subsequent visits use username/password. Account settings offer change password, support and logout; social connection management is outside the current release.

Retain the existing visual system and partner pages. The invite screen is an account setup form, not a contract negotiation or onboarding questionnaire.

## Authority and safeguards

- Staff own partner/recipient verification and access grants. The server binds the invite to the approved partner, recipient reference and capabilities. Browser-supplied partner IDs never grant rights.
- A random, high-entropy, expiring, revocable, single-use invitation is stored only as a hash. Prevent tokens from appearing in logs, analytics or third-party requests; invite/reset screens have no third-party assets and suppress referrer leakage.
- Opening the link must not consume it: messaging link previews and accidental reloads cannot activate an account. The explicit form submission consumes it.
- Validate normalized unique username, password policy, invitation expiry/revocation and active partner state server-side. Invalid input, a taken username or a failed account write must leave a usable unconsumed invitation. Concurrent redemption must create only one account/membership outcome.
- Credential creation, membership activation, invitation consumption and audit must succeed together before returning a usable authenticated session. Prove this through the maintained adapter; do not add an independent password engine or reuse the OAuth callback boundary by assumption.
- A forwarded invite is a bearer credential. Single use alone does not prove the holder is the intended person. Deliver through the previously verified contact; staff verify uncertain delivery before issuing/reissuing access. Never claim the link independently verifies identity.
- Existing users invited to another partner authenticate as their existing account and explicitly accept the added membership. Do not merge accounts based on matching names or contacts. Username is a login handle; immutable internal user ID remains the identity key.
- Retain secure database sessions, server membership checks, CSRF/origin protection, bounded login/reset attempts, generic login failures and cache clearing on logout/access loss. Staff access is separately provisioned; partner invite redemption cannot grant staff roles.
- Staff never choose, view or retrieve a partner password. Hash and verify using the maintained auth library. Permit password-manager/autofill/paste and a show-password control.

## Forgotten password and account changes

Initial recovery uses the existing LabsD support contact. Staff verify the requester through the established contact record, select the exact account and issue a short-lived, one-use reset link. Requesting or issuing a reset does not itself change the password. Successful reset replaces the credential and revokes old sessions atomically; expired, revoked and replayed resets fail. Staff cannot bypass verification by editing a displayed contact field.

Verified email recovery can be added if a real delivery channel is selected; email is not required merely to satisfy an internal library field. Any library-required internal address is non-deliverable metadata and must never become a recovery address. The pinned library's username plugin exists locally, but its full registration/reset integration still needs implementation proof.

## Transition and work packages

| Task | Revised scope | Required evidence |
|---|---|---|
| F03 | Username/password login; invitation setup; used/expired/revoked invitation and suspended access | Existing theme/responsive behavior; accessible forms and password-manager support |
| F07 | Minimal password/account controls; staff issue/revoke/reissue invite and verified reset | Correct recipient/account selected; no staff-readable password or accidental sends |
| A01 | Maintained credential auth and unique normalized usernames | No registration through an unguarded native endpoint; real database credential/session behavior and login throttling |
| A02 | Preapproved invitation activation, scoped membership, password change/recovery | Atomic redemption; concurrent/replayed/expired/revoked link rejection; reset revokes sessions; cross-partner denial |
| A03 | Real frontend/session integration | Invite → create account → overview → logout → login → recovery; stale cached data never crosses users |

Preserve the old social implementation and tests as historical work. Do not run further OAuth provider setup or linking acceptance as a release prerequisite. D-023 exact member selection remains useful; its provider-specific method UI work is paused. Before implementation, inventory all native auth endpoints, configuration, fixtures, account contracts, migrations and consumers, then transition them coherently with social routes disabled for this release. Applied migrations0001–0005 remain immutable; any required schema change is a new ordered migration against an explicitly selected isolated target.

No real customer account inventory was performed in this decision. Verify actual identity records before any credential conversion; never assign passwords to existing users or delete provider records automatically. Rollback must preserve invitations, credentials, membership and audit data; do not reopen public registration or obsolete social routes as an incidental rollback.

## Boundary and acceptance

Change Mode — replace entry and recovery flows. B1/B2/B8: commercial approval stays with LabsD; partners owns invitation grants/membership and identity owns credentials/sessions. B3/B4: shared access contracts and login/account components change together. B9: invitation bearer proof plus credentials replaces external-provider identity; staff authority remains separate. B10: the existing support owner verifies recovery. B5–B7 stay one build/application/Postgres, with no new service.

This decision supersedes prior mandatory social-provider requirements. It does not change earnings, source authority, payment rules or the approved portal layout. Runtime currently remains the earlier social configuration with passwords disabled; this document is not implementation acceptance.

Verdict: **READY FOR DECLARED SCOPE** — invitation-first design and local work sequencing. Registration, reset and migration behavior must be verified before exposure.
