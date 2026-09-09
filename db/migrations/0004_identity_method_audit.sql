-- Additive identity mutation history. Existing auth tables and migrations are unchanged.
CREATE TABLE portal_identity.method_audit (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action = 'unlink'),
  target_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, idempotency_key)
);
CREATE INDEX method_audit_actor_time_idx ON portal_identity.method_audit(actor_id, created_at);
CREATE FUNCTION portal_identity.reject_method_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Identity method history is append-only';
END;
$$;
CREATE TRIGGER method_audit_append_only BEFORE UPDATE OR DELETE ON portal_identity.method_audit
FOR EACH ROW EXECUTE FUNCTION portal_identity.reject_method_audit_mutation();
