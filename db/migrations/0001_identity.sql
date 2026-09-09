CREATE SCHEMA portal_identity;
CREATE TABLE portal_identity.users (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false, image text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_identity.sessions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES portal_identity.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON portal_identity.sessions(user_id);
CREATE INDEX sessions_expiry_idx ON portal_identity.sessions(expires_at);
CREATE TABLE portal_identity.accounts (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES portal_identity.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL, account_id text NOT NULL,
  access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz, scope text, password text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_provider_subject_uq ON portal_identity.accounts(provider_id, account_id);
CREATE INDEX accounts_user_idx ON portal_identity.accounts(user_id);
CREATE TABLE portal_identity.verifications (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX verifications_identifier_uq ON portal_identity.verifications(identifier);
CREATE INDEX verifications_expiry_idx ON portal_identity.verifications(expires_at);
CREATE TABLE portal_identity.rate_limits (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL
);
CREATE TABLE portal_identity.binding (
  id text PRIMARY KEY, namespace_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
