-- Additive, depends on 0002 access, 0016 catalogue. No finance rows or credentials.
CREATE SCHEMA portal_marketing;
CREATE TABLE portal_marketing.connections (
  id text PRIMARY KEY,
  namespace text NOT NULL CHECK(length(namespace) BETWEEN 1 AND 160),
  platform text NOT NULL CHECK(platform='facebook'),
  capability text NOT NULL CHECK(capability='facebook.ad_insights'),
  account_id text NOT NULL CHECK(length(account_id) BETWEEN 1 AND 160),
  label text NOT NULL CHECK(length(label) BETWEEN 1 AND 160),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  enabled boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  UNIQUE(namespace,platform,account_id,capability),
  CHECK(NOT enabled OR verified_at IS NOT NULL)
);
CREATE TABLE portal_marketing.connection_grants (
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  user_id text NOT NULL REFERENCES portal_identity.users(id),
  PRIMARY KEY(connection_id,user_id)
);
-- An association to the agreed deal; does not define rates or create entitlement.
CREATE TABLE portal_marketing.targets (
  id text PRIMARY KEY,
  partner_id text NOT NULL,
  clip_id text NOT NULL,
  agreement_id text NOT NULL CHECK(length(agreement_id) BETWEEN 1 AND 160),
  agreement_label text NOT NULL CHECK(length(agreement_label) BETWEEN 1 AND 160),
  evidence_ref text NOT NULL CHECK(length(evidence_ref)>0),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY(partner_id,clip_id) REFERENCES portal_content.clips(partner_id,id),
  UNIQUE(partner_id,clip_id,agreement_id)
);
CREATE TABLE portal_marketing.lookup_receipts (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES portal_identity.users(id),
  staff_revision bigint NOT NULL,
  target_id text NOT NULL REFERENCES portal_marketing.targets(id),
  target_revision bigint NOT NULL,
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  connection_revision bigint NOT NULL,
  draft jsonb NOT NULL,
  resolved jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX lookup_receipts_expiry ON portal_marketing.lookup_receipts(expires_at);
CREATE TABLE portal_marketing.associations (
  id uuid PRIMARY KEY,
  target_id text NOT NULL REFERENCES portal_marketing.targets(id),
  partner_id text NOT NULL,
  clip_id text NOT NULL,
  agreement_id text NOT NULL,
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  namespace text NOT NULL,
  account_id text NOT NULL,
  platform text NOT NULL CHECK(platform='facebook'),
  object_type text NOT NULL CHECK(object_type='ad'),
  external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 160),
  source_identity jsonb NOT NULL,
  creative_ids jsonb NOT NULL,
  name text NOT NULL,
  mapping_revision bigint NOT NULL DEFAULT 1 CHECK(mapping_revision>0),
  created_by text NOT NULL REFERENCES portal_identity.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(partner_id,clip_id) REFERENCES portal_content.clips(partner_id,id),
  UNIQUE(namespace,platform,account_id,object_type,external_id)
);
CREATE INDEX associations_partner_clip ON portal_marketing.associations(partner_id,clip_id,created_at,id);
CREATE TABLE portal_marketing.sync_jobs (
  id uuid PRIMARY KEY,
  association_id uuid NOT NULL REFERENCES portal_marketing.associations(id),
  mapping_revision bigint NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','needs-attention')),
  attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),
  next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  lease_token uuid,
  last_success_at timestamptz,
  data_through timestamptz,
  issue text,
  UNIQUE(association_id,mapping_revision)
);
CREATE INDEX sync_jobs_due ON portal_marketing.sync_jobs(state,next_run_at,id);
-- Registration history is immutable. Future reassignment needs explicit history/activation.
CREATE TRIGGER marketing_association_immutable BEFORE UPDATE OR DELETE ON portal_marketing.associations
FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();

-- A saved identity never changes under an old receipt or historical association.
-- Changes to access/display state always invalidate outstanding receipts automatically.
CREATE FUNCTION portal_marketing.revise_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='targets' THEN
    IF (NEW.id,NEW.partner_id,NEW.clip_id,NEW.agreement_id) IS DISTINCT FROM
       (OLD.id,OLD.partner_id,OLD.clip_id,OLD.agreement_id) THEN
      RAISE EXCEPTION 'Create a new target for a different binding';
    END IF;
  ELSE
    IF (NEW.id,NEW.namespace,NEW.platform,NEW.capability,NEW.account_id) IS DISTINCT FROM
       (OLD.id,OLD.namespace,OLD.platform,OLD.capability,OLD.account_id) THEN
      RAISE EXCEPTION 'Create a new connection for a different identity';
    END IF;
  END IF;
  NEW.revision := OLD.revision+1;
  RETURN NEW;
END $$;
CREATE TRIGGER marketing_target_revision BEFORE UPDATE ON portal_marketing.targets
FOR EACH ROW EXECUTE FUNCTION portal_marketing.revise_reference();
CREATE TRIGGER marketing_connection_revision BEFORE UPDATE ON portal_marketing.connections
FOR EACH ROW EXECUTE FUNCTION portal_marketing.revise_reference();
