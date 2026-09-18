-- Additive read model for configured external ad bindings; depends on 0018.
-- Does not change identity, native marketing associations or financial ledgers.
CREATE TABLE portal_marketing.external_ad_snapshots (
  namespace_digest text NOT NULL CHECK (namespace_digest ~ '^[a-f0-9]{64}$'),
  binding_key text NOT NULL CHECK (binding_key ~ '^[a-f0-9]{64}$'),
  period_from date NOT NULL,
  period_to date NOT NULL CHECK (period_to > period_from AND period_to - period_from <= 93),
  snapshot jsonb,
  fetched_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  issue text CHECK (issue IN ('unavailable')),
  CHECK ((snapshot IS NULL) = (fetched_at IS NULL)),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  PRIMARY KEY(namespace_digest,binding_key,period_from,period_to)
);
CREATE INDEX external_ad_snapshots_due ON portal_marketing.external_ad_snapshots(namespace_digest,next_run_at);
