CREATE TABLE portal_identity.mutation_clock (
  id text PRIMARY KEY CHECK(id = 'current'), revision bigint NOT NULL CHECK(revision >= 0)
);
INSERT INTO portal_identity.mutation_clock(id,revision) VALUES ('current',0);
CREATE TABLE portal_identity.user_fences (
  user_id text PRIMARY KEY REFERENCES portal_identity.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK(revision >= 0)
);
CREATE TABLE portal_identity.subject_fences (
  subject_digest text PRIMARY KEY CHECK(subject_digest ~ '^[a-f0-9]{64}$'),
  revision bigint NOT NULL CHECK(revision >= 0)
);
CREATE TABLE portal_identity.oauth_intents (
  id text PRIMARY KEY,
  provider text NOT NULL CHECK(provider IN ('google','line','apple')),
  purpose text NOT NULL CHECK(purpose IN ('sign-in','link')),
  actor_id text,
  session_id text,
  start_revision bigint NOT NULL CHECK(start_revision >= 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'link' AND actor_id IS NOT NULL AND session_id IS NOT NULL)
    OR (purpose = 'sign-in' AND actor_id IS NULL AND session_id IS NULL))
);
CREATE INDEX oauth_intents_expiry_idx ON portal_identity.oauth_intents(expires_at);
ALTER TABLE portal_identity.method_audit DROP CONSTRAINT method_audit_action_check;
ALTER TABLE portal_identity.method_audit ADD CONSTRAINT method_audit_action_check
  CHECK(action IN ('unlink','link'));
