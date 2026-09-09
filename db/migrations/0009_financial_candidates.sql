-- Additive local candidate storage, depends on 0002_partner_access.sql.
-- These are internal draft generations; this migration grants no partner read/publication authority.
CREATE SCHEMA portal_imports;
CREATE TABLE portal_imports.scopes (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL,
  fence bigint NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  current_generation uuid,
  approval_sequence bigint NOT NULL DEFAULT 0 CHECK(approval_sequence >= 0),
  closed_statement_ref text,
  CHECK(period_from < period_to),
  CHECK((lease_token IS NULL) = (lease_until IS NULL)),
  UNIQUE(partner_id,period_from,period_to)
);
CREATE INDEX import_scope_partner_period ON portal_imports.scopes(partner_id,period_from,period_to);
CREATE TABLE portal_imports.runs (
  id uuid PRIMARY KEY,
  scope_id text NOT NULL REFERENCES portal_imports.scopes(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  approval_ref text NOT NULL,
  approval_sequence bigint NOT NULL CHECK(approval_sequence > 0),
  fence bigint NOT NULL,
  state text NOT NULL CHECK(state IN ('running','ready','blocked','failed','superseded')),
  issues jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  UNIQUE(scope_id,idempotency_key),
  CHECK(request_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE portal_imports.generations (
  id uuid PRIMARY KEY REFERENCES portal_imports.runs(id),
  scope_id text NOT NULL REFERENCES portal_imports.scopes(id),
  approval_sequence bigint NOT NULL CHECK(approval_sequence > 0),
  file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
  approval_context jsonb NOT NULL,
  included_count integer NOT NULL CHECK(included_count >= 0),
  excluded_count integer NOT NULL CHECK(excluded_count >= 0),
  eligible_base_minor numeric(40,0) NOT NULL,
  amount_minor numeric(40,0) NOT NULL,
  data_through timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(scope_id,approval_sequence),
  UNIQUE(scope_id,id)
);
ALTER TABLE portal_imports.scopes ADD CONSTRAINT scoped_current_generation
  FOREIGN KEY(id,current_generation) REFERENCES portal_imports.generations(scope_id,id);
CREATE TABLE portal_imports.earning_rows (
  generation_id uuid NOT NULL REFERENCES portal_imports.generations(id),
  entitlement_key text NOT NULL,
  source_revision text NOT NULL,
  earned_at timestamptz NOT NULL,
  content_id text,
  disposition text NOT NULL CHECK(disposition IN ('included','excluded')),
  amount_minor numeric(40,0),
  eligible_base_minor numeric(40,0),
  payload jsonb NOT NULL,
  PRIMARY KEY(generation_id,entitlement_key),
  CHECK((disposition='included') = (amount_minor IS NOT NULL))
);
CREATE INDEX earning_rows_time ON portal_imports.earning_rows(generation_id,earned_at,entitlement_key);
CREATE INDEX earning_rows_content ON portal_imports.earning_rows(generation_id,content_id,earned_at,entitlement_key);
CREATE FUNCTION portal_imports.immutable_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Candidate generations are immutable'; END;
$$;
CREATE TRIGGER generations_immutable BEFORE UPDATE OR DELETE ON portal_imports.generations
  FOR EACH ROW EXECUTE FUNCTION portal_imports.immutable_candidate();
CREATE TRIGGER earning_rows_immutable BEFORE UPDATE OR DELETE ON portal_imports.earning_rows
  FOR EACH ROW EXECUTE FUNCTION portal_imports.immutable_candidate();
