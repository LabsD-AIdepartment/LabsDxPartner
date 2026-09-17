# Native invitation and account recovery acceptance

Verified locally on 2026-09-11 against the existing production build, HTTPS and isolated PostgreSQL. The actor and partner are synthetic; no customer, provider account or external message was involved. This verifies the existing private invitation flow, not public signup or social login.

## Observed browser journey

- Staff selected the agreed test partner, reviewed recipient/contact and capabilities, and created an invitation. Creation did not send a message automatically.
- Recipient opened the invitation, chose an English username and matching passwords, and arrived at the native Overview with the correct membership. The consumed token was cleared from the address bar.
- Changing the password from Account returned to Login. The old password was rejected; the new password opened Overview.
- An expired staff freshness window refused reset-link issuance and requested sign-in. After fresh staff sign-in, the reviewed reset link was issued for the intended member.
- The recipient set a replacement password. The success page cleared the fragment and prompted sign-in. A fresh visit to the consumed reset link displayed its invalid-link message and no password fields.
- The pre-reset password was rejected; the replacement password opened Overview with the same member identity.
- Revisiting the claimed invitation displayed its invalid-link message and no registration password fields.
- Signing out and requesting Overview redirected to `/login?next=%2Foverview`.

## Supporting verification and limits

The existing `passwords`, `invitation-activation`, and `access-http` integration suites passed: 31 tests across three files. They include session revocation, single-use reset, concurrent reset/login serialization and rollback behavior. Multi-device session revocation is integration-test evidence; the manual browser journey used one tab.

No product source changed in this acceptance batch, so no new build or unit-test result is claimed. The prior reviewed D090 build was reused. Full evidence is under the ignored `.agent-work/20260911-account-journey/`, including sanitized browser checkpoints and the integration transcript.

One reauthentication-link click did not produce an observable navigation before the automation deadline; directly loading its existing Login destination worked. D123 subsequently reproduced actual link clicks and successful login returns for all three native staff destinations; see [native reauthentication acceptance](native-reauth-acceptance.md). The earlier cause remains unknown, but the local navigation acceptance gap is closed on the D120 web artifact. Same-document token navigation also required a fresh page visit before checking consumed-link rejection; intermediate snapshots are not acceptance evidence.

Remaining separate work: authenticated document downloads, actual 200% browser zoom and visual review, remaining account-page agreement/detail parity, query/load measurements, operational readiness and live-provider acceptance when accounts are available. This batch does not close the full P04 or release milestone.
