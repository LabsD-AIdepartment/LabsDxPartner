-- Self-entered contact metadata; deliberately separate from verified identity/recovery facts.
CREATE TABLE portal_access.account_contacts (
  partner_id text NOT NULL,
  user_id text NOT NULL,
  email text,
  phone text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (partner_id, user_id),
  FOREIGN KEY (partner_id, user_id) REFERENCES portal_access.memberships(partner_id, user_id),
  CHECK (email IS NULL OR length(email) BETWEEN 3 AND 200),
  CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{8,15}$')
);
