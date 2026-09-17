-- Expand0024; retain existing windows and immutable observations. No scheduler is enabled here.
CREATE TABLE portal_marketing.video_schedules (
  connection_id text PRIMARY KEY REFERENCES portal_marketing.connections(id),
  period_from date NOT NULL,
  period_to date NOT NULL CHECK(period_to>period_from AND period_to-period_from<=366),
  timezone text NOT NULL,
  connection_revision bigint NOT NULL,
  profile_hash text NOT NULL CHECK(profile_hash ~ '^[a-f0-9]{64}$'),
  last_claimed_at timestamptz,
  plan_as_of timestamptz NOT NULL
);
ALTER TABLE portal_marketing.video_windows
  ADD COLUMN refresh_seconds integer NOT NULL DEFAULT 86400 CHECK(refresh_seconds BETWEEN 60 AND 604800),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 30),
  ADD COLUMN retry_paused boolean NOT NULL DEFAULT false;
CREATE INDEX video_due_windows ON portal_marketing.video_windows(connection_id,next_attempt_at,period_from)
  WHERE NOT retry_paused;
