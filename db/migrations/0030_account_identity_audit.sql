-- Expand the audit vocabulary for the authenticated, password-confirmed identity editor.
-- Existing actions and rows remain valid; rollback of application code needs no data rollback.
ALTER TABLE portal_identity.method_audit DROP CONSTRAINT method_audit_action_check;
ALTER TABLE portal_identity.method_audit ADD CONSTRAINT method_audit_action_check
  CHECK (action IN ('unlink','link','issue-password-reset','reset-password','change-password','change-account-identity'));
