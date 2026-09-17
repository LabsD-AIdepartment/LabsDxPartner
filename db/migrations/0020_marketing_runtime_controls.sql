-- Additive; depends on 0019. No live source grants or credentials.
CREATE TABLE portal_marketing.request_limits (
  bucket text PRIMARY KEY,
  next_at timestamptz NOT NULL DEFAULT '-infinity',
  blocked_until timestamptz NOT NULL DEFAULT '-infinity'
);
ALTER TABLE portal_marketing.report_windows ADD COLUMN refresh_seconds integer NOT NULL DEFAULT 900
  CHECK (refresh_seconds BETWEEN 60 AND 86400);
ALTER TABLE portal_marketing.sync_jobs ADD COLUMN last_planned_at timestamptz;
ALTER TABLE portal_marketing.connection_runtime ADD COLUMN last_claimed_at timestamptz;
