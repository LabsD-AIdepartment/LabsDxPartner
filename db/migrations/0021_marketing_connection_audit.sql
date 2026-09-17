-- Additive; depends on0020 and existing identity. No grants or source activation.
ALTER TABLE portal_marketing.connections ADD COLUMN verification jsonb;
CREATE TABLE portal_marketing.connection_commands (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES portal_identity.users(id),
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  action text NOT NULL CHECK(action IN ('verify','pause','retry')),
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_id,id)
);
CREATE INDEX marketing_connection_commands_account ON portal_marketing.connection_commands(connection_id,created_at);
CREATE TRIGGER marketing_connection_command_immutable BEFORE UPDATE OR DELETE ON portal_marketing.connection_commands
FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
