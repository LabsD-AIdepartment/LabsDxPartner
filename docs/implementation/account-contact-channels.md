# Account contact channels

The native `/account` screen mounts `AccountContacts` through the stable `AccountPage.contacts`
slot. The reusable form reads and saves through `ContactTransport`; native composition supplies
`contactHttp`. Account metadata and password forms retain their own independent lifecycles.

`GET /api/v1/partner/account/contacts` takes `partnerId` and `permissionRevision`.
`PUT` accepts those fields plus `expectedUserId`, `expectedRevision`, and `{contact:{email,phone}}`.
Both contact values are nullable (clearing is supported). Email is trimmed; phone accepts common
formatting, removes spaces/parentheses/hyphens, and retains an optional leading `+` with 8–15 digits.
No country or dialing prefix is invented. Email ownership and telephone reachability are unknown.

The authenticated user and active membership determine the row in
`portal_access.account_contacts`; caller `expectedUserId` is only an account-switch fence.
Permission revision is rechecked in the authorized transaction. Writes use compare-and-swap,
including the first insert. Conflict and uncertain network completion require an explicit read
before another edit. Mutation requests enforce registered same-origin, JSON and bounded bodies.
Responses are private/no-store; API telemetry records route/status, never the submitted contacts.

All saved contacts have `verification: unverified`. They do not change native identity email,
passwords, membership verification evidence, recovery authority, or staff invitation delivery.
No SMS/email dispatch, verification or opt-in preference is represented as active. Intended future
uses are commission-release notices, withdrawal reports, recovery and partner invitations. Before
connecting them, implement verified destinations and the applicable delivery/consent/recovery
policy; recovery and invitations must not trust self-entered metadata as ownership proof.

Migration `0029_account_contacts.sql` is additive after `0028`; the required-migration manifest
locks its checksum. Apply it before exposing the form. Old code continues to work and ignores the
new table. Code rollback retains contact data; there is no destructive down migration.

Verification: native signed-session integration covers persistence/clear/normalization, actor and
partner isolation, stale permission/contact revisions, concurrent CAS, session-account switches,
origin and body validation, and unchanged identity facts. Form tests cover invalid inputs,
loading/save/conflict, uncertain completion and late responses after scope change. Responsive
checks import the real form/styles at 280, 375, 800 and 1957 CSS pixels in both themes.
