-- Additive; depends on 0022 and existing source identity/connection invariants.
-- Records trusted operator actions, never credential values or new source activation.
CREATE TABLE portal_marketing.provision_commands (
  id uuid PRIMARY KEY,
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  operator_ref text NOT NULL CHECK(length(operator_ref) BETWEEN 1 AND 160),
  evidence_ref text NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 500),
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
  changes jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX marketing_provision_account ON portal_marketing.provision_commands(connection_id,created_at);
CREATE TRIGGER marketing_provision_immutable BEFORE UPDATE OR DELETE ON portal_marketing.provision_commands
FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
