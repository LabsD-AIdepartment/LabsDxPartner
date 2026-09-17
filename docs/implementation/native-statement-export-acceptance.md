# Native statement export acceptance

2026-09-11: verified the existing local HTTPS application with isolated PostgreSQL and synthetic partner data. No product source changed in this batch.

## What was verified

- The partner opened Transactions and the published July–August 2026 statement. Its confirmed earnings and outstanding balance were both THB37,360, with no recorded payment.
- Preparing the CSV through the native UI produced the ready state. After the preparation expired, clicking Download displayed the expiry message. Retry prepared it again successfully.
- An independent authenticated HTTPS client downloaded the real export endpoint into the project work area. It used its own synthetic login session, not extracted browser credentials.
- The file contained six unique earning lines covering all six clips. Decimal amounts summed exactly to THB37,360 commission and THB550,000 eligible sales using integer minor units. Statement ID, immutable version and period matched the authenticated statement API and displayed statement.
- UTF-8 BOM, CSV content type, attachment filename and `private, no-store` were verified. File size: 1,701 bytes. SHA-256: `4c367921cfbef793a6a63672716434a76d1c2540a8c814464d98a5a858ef6238`.
- Native HTTP returned 200 for the authorized partner, 401 without authentication, 403 for staff without partner membership, 403 for a different partner identifier and 409 for a stale statement version.
- Existing tests passed: 12 integration cases in `statements.test.ts`; 35 unit/component cases across statement export, transaction HTTP and transactions. Tests cover authorization re-checks, revoked membership, lifecycle disposal, download errors and spreadsheet-formula escaping within their respective scopes.

## Acceptance limits

The downloaded bytes were verified through the native HTTP endpoint. A successful final browser save was **not** verified: the available browser interface did not advertise control over the download destination, while agent artifacts must stay inside the project. No claim that a browser save, PDF, payment receipt or withholding document was tested. The implemented native document in this fixture is the statement CSV.

The local harness needed the existing mkcert root CA via `NODE_EXTRA_CA_CERTS`; system-CA lookup and using the leaf as the CA failed. Certificate validation remained enabled and the trust store was unchanged.

Evidence and the reproducible native client are in `.agent-work/20260911-document-acceptance/`. Next acceptance work includes the browser save, account/detail parity, actual 200% zoom, load and operational readiness. P04 and production release remain open.
