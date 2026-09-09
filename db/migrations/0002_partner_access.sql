-- Additive; depends on 0001_identity.sql. One serialized migration owner.
CREATE SCHEMA portal_access;
CREATE TABLE portal_access.partners (
  id text PRIMARY KEY, name text NOT NULL CONSTRAINT partner_name CHECK(length(name) BETWEEN 1 AND 200),
  status text NOT NULL CONSTRAINT partner_status CHECK(status IN ('active','suspended')),
  revision bigint NOT NULL DEFAULT 1 CONSTRAINT partner_revision CHECK(revision > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE portal_access.memberships (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  user_id text NOT NULL REFERENCES portal_identity.users(id),
  status text NOT NULL CONSTRAINT member_status CHECK(status IN ('pending','active','suspended')),
  capabilities text[] NOT NULL DEFAULT '{}',
  permission_revision bigint NOT NULL DEFAULT 1 CONSTRAINT member_revision CHECK(permission_revision > 0),
  verified_contact_ref text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_partner_id_user_id_unique UNIQUE(partner_id,user_id),
  CONSTRAINT member_capabilities CHECK(capabilities <@ ARRAY['view_earnings','view_content','view_statements','view_ad_spend']::text[] AND cardinality(capabilities) <= 4),
  CONSTRAINT member_active_verified CHECK(status <> 'active' OR (verified_contact_ref IS NOT NULL AND length(verified_contact_ref) > 0 AND cardinality(capabilities) > 0))
);
CREATE INDEX memberships_user_idx ON portal_access.memberships(user_id,partner_id);
CREATE TABLE portal_access.staff_grants (
  user_id text PRIMARY KEY REFERENCES portal_identity.users(id),
  capabilities text[] NOT NULL,
  active boolean NOT NULL,
  provision_ref text NOT NULL CONSTRAINT staff_provision CHECK(length(provision_ref) > 0),
  revision bigint NOT NULL DEFAULT 1 CONSTRAINT staff_revision CHECK(revision > 0),
  CONSTRAINT staff_caps CHECK(capabilities <@ ARRAY['manage_partners','review_imports','publish_statements','record_payments']::text[])
);
CREATE TABLE portal_access.invites (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  token_hash text NOT NULL CONSTRAINT invites_token_hash_unique UNIQUE CONSTRAINT invite_hash CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES portal_identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  claimed_at timestamptz, claimed_by text REFERENCES portal_identity.users(id),
  CONSTRAINT invite_claim CHECK((claimed_at IS NULL) = (claimed_by IS NULL)),
  CONSTRAINT invite_expiry CHECK(expires_at > created_at)
);
CREATE INDEX invites_partner_idx ON portal_access.invites(partner_id,created_at,id);
CREATE TABLE portal_access.audit (
  id text PRIMARY KEY,
  actor_id text NOT NULL REFERENCES portal_identity.users(id),
  action text NOT NULL,
  partner_id text NOT NULL REFERENCES portal_access.partners(id),
  target_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CONSTRAINT audit_hash CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_actor_id_idempotency_key_unique UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX audit_partner_idx ON portal_access.audit(partner_id,created_at,id);
CREATE FUNCTION portal_access.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Authorization audit is append-only'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON portal_access.audit
FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
