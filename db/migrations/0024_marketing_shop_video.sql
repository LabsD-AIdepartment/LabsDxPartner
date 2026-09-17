-- Expand after0023. Video facts are not Facebook ad facts or financial entries.
ALTER TABLE portal_marketing.connections DROP CONSTRAINT connections_platform_check;
ALTER TABLE portal_marketing.connections DROP CONSTRAINT connections_capability_check;
ALTER TABLE portal_marketing.connections ADD CONSTRAINT connections_supported_capability CHECK (
  (platform='facebook' AND capability='facebook.ad_insights') OR
  (platform='tiktok' AND capability='tiktok.shop_video')
);
CREATE TABLE portal_marketing.video_windows (
  id uuid PRIMARY KEY,
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  period_from date NOT NULL,
  period_to date NOT NULL CHECK(period_to>period_from AND period_to-period_from<=31),
  timezone text NOT NULL,
  connection_revision bigint NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','needs-attention')),
  lease_token uuid,
  lease_until timestamptz,
  current_generation uuid,
  last_success_at timestamptz,
  issue text,
  CHECK((lease_token IS NULL)=(lease_until IS NULL)),
  UNIQUE(connection_id,period_from,period_to,timezone)
);
CREATE TABLE portal_marketing.video_generations (
  id uuid PRIMARY KEY,
  window_id uuid NOT NULL REFERENCES portal_marketing.video_windows(id),
  lease_token uuid NOT NULL UNIQUE,
  connection_revision bigint NOT NULL,
  report_hash text NOT NULL CHECK(report_hash ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(window_id,id)
);
ALTER TABLE portal_marketing.video_windows ADD CONSTRAINT video_current_generation
  FOREIGN KEY(id,current_generation) REFERENCES portal_marketing.video_generations(window_id,id);
CREATE TABLE portal_marketing.video_observations (
  generation_id uuid NOT NULL REFERENCES portal_marketing.video_generations(id),
  video_id text NOT NULL CHECK(length(video_id) BETWEEN 1 AND 160),
  creator_id text NOT NULL CHECK(length(creator_id) BETWEEN 1 AND 160),
  observation jsonb NOT NULL,
  PRIMARY KEY(generation_id,video_id)
);
CREATE INDEX video_observation_lookup ON portal_marketing.video_observations(video_id,generation_id);
CREATE TABLE portal_marketing.video_mappings (
  id uuid PRIMARY KEY,
  target_id text NOT NULL REFERENCES portal_marketing.targets(id),
  connection_id text NOT NULL REFERENCES portal_marketing.connections(id),
  namespace text NOT NULL,
  shop_id text NOT NULL,
  video_id text NOT NULL,
  creator_id text NOT NULL,
  proof_generation uuid NOT NULL,
  created_by text NOT NULL REFERENCES portal_identity.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(proof_generation,video_id) REFERENCES portal_marketing.video_observations(generation_id,video_id),
  UNIQUE(namespace,shop_id,video_id)
);
CREATE INDEX video_mapping_target ON portal_marketing.video_mappings(target_id,created_at,id);
CREATE TRIGGER video_generation_immutable BEFORE UPDATE OR DELETE ON portal_marketing.video_generations
  FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
CREATE TRIGGER video_observation_immutable BEFORE UPDATE OR DELETE ON portal_marketing.video_observations
  FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
CREATE TRIGGER video_mapping_immutable BEFORE UPDATE OR DELETE ON portal_marketing.video_mappings
  FOR EACH ROW EXECUTE FUNCTION portal_access.reject_audit_mutation();
