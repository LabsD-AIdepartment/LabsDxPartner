-- Depends on0011 issued statements and0009 immutable earning rows.
CREATE TABLE portal_imports.correction_links (
  generation_id uuid NOT NULL,
  entitlement_key text NOT NULL,
  original_generation_id uuid NOT NULL,
  original_entitlement_key text NOT NULL,
  revision_sequence bigint NOT NULL CHECK(revision_sequence>0),
  prior_sequence bigint NOT NULL CHECK(prior_sequence>=0),
  prior_amount_minor numeric(40,0) NOT NULL,
  revised_amount_minor numeric(40,0) NOT NULL,
  PRIMARY KEY(generation_id,entitlement_key),
  UNIQUE(generation_id,original_generation_id,original_entitlement_key),
  FOREIGN KEY(generation_id,entitlement_key) REFERENCES portal_imports.earning_rows(generation_id,entitlement_key),
  FOREIGN KEY(original_generation_id,original_entitlement_key) REFERENCES portal_imports.earning_rows(generation_id,entitlement_key),
  CHECK(revision_sequence>prior_sequence)
);
CREATE INDEX correction_original_revision ON portal_imports.correction_links(original_generation_id,original_entitlement_key,revision_sequence DESC);
CREATE TRIGGER correction_links_immutable BEFORE UPDATE OR DELETE ON portal_imports.correction_links
  FOR EACH ROW EXECUTE FUNCTION portal_imports.immutable_candidate();
