-- Additive; depends on 0018 marketing registration and 0015 change revisions.
-- No changes to applied migrations, financial ledgers, grants or credentials.
CREATE TABLE portal_marketing.connection_runtime (
  connection_id text PRIMARY KEY REFERENCES portal_marketing.connections(id),
  blocked_until timestamptz NOT NULL DEFAULT '-infinity',
  lease_token uuid,
  lease_until timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
CREATE TABLE portal_marketing.report_windows (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES portal_marketing.sync_jobs(id),
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL CHECK (period_to > period_from),
  timezone text NOT NULL,
  definition jsonb NOT NULL,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','ready','needs-attention')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  current_generation uuid,
  issue text,
  last_success_at timestamptz,
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  UNIQUE(job_id,period_from,period_to,timezone,definition_hash)
);
CREATE INDEX report_windows_due ON portal_marketing.report_windows(next_run_at,id);
CREATE TABLE portal_marketing.report_generations (
  id uuid PRIMARY KEY,
  window_id uuid NOT NULL REFERENCES portal_marketing.report_windows(id),
  report jsonb NOT NULL,
  report_sha256 text NOT NULL CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(window_id,id)
);
ALTER TABLE portal_marketing.report_windows ADD CONSTRAINT current_report_same_window
  FOREIGN KEY(id,current_generation) REFERENCES portal_marketing.report_generations(window_id,id);
CREATE TRIGGER marketing_report_immutable BEFORE UPDATE OR DELETE ON portal_marketing.report_generations
FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
