-- Additive partner-facing agreement metadata; does not affect financial calculations.
CREATE TABLE portal_access.account_profiles (
  partner_id text PRIMARY KEY REFERENCES portal_access.partners(id),
  revision bigint NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_by text NOT NULL REFERENCES portal_identity.users(id)
);
