# Native staff reauthentication acceptance — D123

Verified on 11 September 2026 in the existing in-app browser, against the locally built native application at `https://127.0.0.1:4443`. The running web artifact remains D120, build `V_OKbpG5OhG1keKWUBTuD`. This batch changes acceptance documentation only; it does not change authentication code, rotate credentials, publish statements or activate a provider.

## Observed return journeys

Using the existing synthetic staff account, each journey began by clicking the rendered **ยืนยันตัวตนเจ้าหน้าที่อีกครั้ง** link, then submitting the login form. No direct navigation substituted for the link click.

| Starting page | Observed login destination | Observed return after login |
|---|---|---|
| `/ops/periods` | `/login?next=%2Fops%2Fperiods` | `/ops/periods`, native finance heading and data visible |
| `/ops/access` | `/login?next=%2Fops%2Faccess` | `/ops/access`, native partner administration visible |
| `/ops/ads` | `/login?next=%2Fops%2Fads` | `/ops/ads`, native clip/connection controls visible |

This closes the unclassified navigation observation recorded in [native account acceptance](native-account-acceptance.md) for this local candidate. It does not establish the cause of that earlier observation. Return-path acceptance concerns the page destination; an in-memory search/filter selection is not retained or asserted by these receipts. No protected financial or membership write was performed to test freshness; those service authorization checks retain their separate existing evidence.

## Login readability and form semantics

The empty login form was measured in both Day and Dark at actual CSS widths **280, 375, 1,016 and 1,440 px** (eight combinations). In all eight, document scroll width equaled viewport width, input/button bounds stayed within the viewport, and measured rendered text had a minimum computed font size of **16 px**. Captures include mobile Dark and wide Day visual checks. This preserves the existing approved design; it is not a redesign or a claim of pixel-perfect rendering across browsers.

Rendered username/password inputs expose `autocomplete="username"` and `autocomplete="current-password"`; the password input uses `type="password"`. These DOM attributes support password managers but do not prove native autofill/save behavior. No browser credential store was accessed, and no password values appear in saved snapshots or screenshots.

## Evidence and limits

Sanitized journey receipts, eight full measurement records, empty-form captures and repository-state evidence are retained in the ignored `.agent-work/20260911-native-reauth/`. The browser ended on native `/ops/ads`, Day, at its original 1,016 px viewport with the synthetic staff session.

This is native acceptance evidence on an existing frozen build, not a new build or test-suite result. Still open: actual browser 200% zoom, native password-manager interaction, the remaining invitation/reset/account visual matrix, final browser document save and target-specific release acceptance. D124 subsequently completed [isolated signing-key rotation](signing-key-rotation-acceptance.md); actual target rollout and any required global-invalidation procedure remain separate. Viewport narrowing is not browser zoom; correct input attributes are not autofill acceptance. Real platform/account blockers remain deferred under the owner's instruction.
