-- Additive, depends on0009 candidate storage and0002 access audit.
CREATE TABLE portal_imports.approvals (
  id uuid PRIMARY KEY,
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  review_id text NOT NULL,
  review_digest text NOT NULL CHECK(review_digest ~ '^[a-f0-9]{64}$'),
  context jsonb NOT NULL,
  approved_by text NOT NULL REFERENCES portal_identity.users(id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(partner_id,review_id,review_digest)
);
CREATE TABLE portal_imports.approval_revocations (
  approval_id uuid PRIMARY KEY REFERENCES portal_imports.approvals(id),
  reason_ref text NOT NULL CHECK(length(reason_ref)>0),
  revoked_by text NOT NULL REFERENCES portal_identity.users(id),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE SCHEMA portal_statements;
CREATE TABLE portal_statements.statements (
  id uuid PRIMARY KEY,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  scope_id text NOT NULL UNIQUE REFERENCES portal_imports.scopes(id),
  generation_id uuid NOT NULL UNIQUE,
  approval_id uuid NOT NULL REFERENCES portal_imports.approvals(id),
  period_from timestamptz NOT NULL,
  period_to timestamptz NOT NULL,
  opening_minor numeric(40,0) NOT NULL DEFAULT 0,
  new_earnings_minor numeric(40,0) NOT NULL,
  adjustments_minor numeric(40,0) NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL CHECK(excluded_count>=0),
  scheduled_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_by text NOT NULL REFERENCES portal_identity.users(id),
  CHECK(period_from < period_to),
  CHECK(scheduled_at >= period_to),
  FOREIGN KEY(scope_id,generation_id) REFERENCES portal_imports.generations(scope_id,id),
  UNIQUE(partner_id,id)
);
CREATE INDEX statement_partner_period ON portal_statements.statements(partner_id,period_from,id);
CREATE TABLE portal_statements.revisions (
  partner_id text PRIMARY KEY REFERENCES portal_access.partners(id),
  statements bigint NOT NULL DEFAULT 0,
  settlements bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION portal_statements.immutable_finance_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial records are append-only'; END;
$$;
CREATE TRIGGER approvals_immutable BEFORE UPDATE OR DELETE ON portal_imports.approvals
  FOR EACH ROW EXECUTE FUNCTION portal_statements.immutable_finance_record();
CREATE TRIGGER approval_revocations_immutable BEFORE UPDATE OR DELETE ON portal_imports.approval_revocations
  FOR EACH ROW EXECUTE FUNCTION portal_statements.immutable_finance_record();
CREATE TRIGGER statements_immutable BEFORE UPDATE OR DELETE ON portal_statements.statements
  FOR EACH ROW EXECUTE FUNCTION portal_statements.immutable_finance_record();
