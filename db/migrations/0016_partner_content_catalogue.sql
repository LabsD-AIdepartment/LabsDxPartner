-- Additive metadata, depends on0015 changes,0002 access. No monetary rows are changed.
CREATE SCHEMA portal_content;
CREATE TABLE portal_content.catalogues (
  partner_id text PRIMARY KEY REFERENCES portal_access.partners(id),
  revision bigint NOT NULL CHECK(revision > 0),
  source_revision text NOT NULL,
  evidence_ref text NOT NULL,
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
  profile jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_by text NOT NULL REFERENCES portal_identity.users(id)
);
CREATE TABLE portal_content.clips (
  partner_id text NOT NULL REFERENCES portal_content.catalogues(partner_id),
  id text NOT NULL,
  title text NOT NULL,
  brand text NOT NULL,
  published_at timestamptz NOT NULL,
  cover text,
  cover_position text NOT NULL,
  removed boolean NOT NULL,
  source_url text,
  PRIMARY KEY(partner_id,id)
);
CREATE INDEX clips_partner_published ON portal_content.clips(partner_id,published_at DESC,id DESC);
CREATE INDEX clips_partner_brand ON portal_content.clips(partner_id,brand,id);
