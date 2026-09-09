-- Additive D-025 transition. Existing social identities remain untouched.
ALTER TABLE portal_identity.users ADD COLUMN username text;
ALTER TABLE portal_identity.users ADD CONSTRAINT users_username_normalized
  CHECK (username IS NULL OR (length(username) BETWEEN 3 AND 30 AND username ~ '^[a-z0-9_.]+$'));
CREATE UNIQUE INDEX users_username_uq ON portal_identity.users(username);
