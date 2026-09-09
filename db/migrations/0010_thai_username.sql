-- Preserve existing ASCII handles and uniqueness; accept Thai handles in the shared contract.
ALTER TABLE portal_identity.users DROP CONSTRAINT users_username_normalized;
ALTER TABLE portal_identity.users ADD CONSTRAINT users_username_normalized
  CHECK (username IS NULL OR (
    length(username) BETWEEN 3 AND 30
    AND username COLLATE "C" ~ '^[a-z0-9_.ก-ฺเ-๎๐-๙]+$'
  ));
