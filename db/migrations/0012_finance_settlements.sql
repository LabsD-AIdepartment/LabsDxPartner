-- Depends on0011. Imports approved external finance facts; does not execute bank payments.
CREATE TABLE portal_statements.settlements (
  id uuid PRIMARY KEY,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  authority text NOT NULL,
  account text NOT NULL,
  reference text NOT NULL,
  record_digest text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('payment','reversal')),
  original_id uuid REFERENCES portal_statements.settlements(id),
  evidence_ref text NOT NULL,
  reason_ref text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_by text NOT NULL REFERENCES portal_identity.users(id),
  UNIQUE(authority,account,reference),
  UNIQUE(partner_id,id),
  CHECK((kind='payment' AND original_id IS NULL AND reason_ref IS NULL)
    OR (kind='reversal' AND original_id IS NOT NULL AND reason_ref IS NOT NULL))
);
CREATE UNIQUE INDEX settlement_single_reversal ON portal_statements.settlements(original_id) WHERE original_id IS NOT NULL;
CREATE INDEX settlement_partner_time ON portal_statements.settlements(partner_id,recorded_at,id);
CREATE TABLE portal_statements.allocations (
  partner_id text NOT NULL,
  settlement_id uuid NOT NULL,
  statement_id uuid NOT NULL,
  cash_minor numeric(40,0) NOT NULL,
  withholding_minor numeric(40,0) NOT NULL,
  other_minor numeric(40,0) NOT NULL,
  other_reason_ref text,
  PRIMARY KEY(settlement_id,statement_id),
  FOREIGN KEY(partner_id,settlement_id) REFERENCES portal_statements.settlements(partner_id,id),
  FOREIGN KEY(partner_id,statement_id) REFERENCES portal_statements.statements(partner_id,id),
  CHECK((cash_minor>=0 AND withholding_minor>=0 AND other_minor>=0 AND cash_minor+withholding_minor+other_minor>0)
    OR (cash_minor<=0 AND withholding_minor<=0 AND other_minor<=0 AND cash_minor+withholding_minor+other_minor<0)),
  CHECK(other_minor=0 OR other_reason_ref IS NOT NULL)
);
CREATE INDEX allocations_statement ON portal_statements.allocations(partner_id,statement_id);
CREATE TRIGGER settlements_immutable BEFORE UPDATE OR DELETE ON portal_statements.settlements
  FOR EACH ROW EXECUTE FUNCTION portal_statements.immutable_finance_record();
CREATE TRIGGER allocations_immutable BEFORE UPDATE OR DELETE ON portal_statements.allocations
  FOR EACH ROW EXECUTE FUNCTION portal_statements.immutable_finance_record();
