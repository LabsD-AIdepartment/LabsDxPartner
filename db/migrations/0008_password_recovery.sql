CREATE TABLE portal_identity.password_resets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES portal_identity.users(id),
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  membership_revision bigint NOT NULL CHECK (membership_revision > 0),
  verified_contact_ref text NOT NULL CHECK (length(verified_contact_ref)>0),
  verification_evidence_ref text NOT NULL CHECK (length(verification_evidence_ref)>0),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL REFERENCES portal_identity.users(id),
  issuer_revision bigint NOT NULL CHECK (issuer_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX password_resets_pending_user_uq ON portal_identity.password_resets(user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX password_resets_expiry_idx ON portal_identity.password_resets(expires_at);
ALTER TABLE portal_identity.method_audit DROP CONSTRAINT method_audit_action_check;
ALTER TABLE portal_identity.method_audit ADD CONSTRAINT method_audit_action_check
  CHECK (action IN ('unlink','link','issue-password-reset','reset-password','change-password'));
