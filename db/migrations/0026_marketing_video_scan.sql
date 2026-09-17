-- Expand0025. Disposable worker staging; published generations remain immutable.
CREATE TABLE portal_marketing.video_scans (
  connection_id text PRIMARY KEY REFERENCES portal_marketing.connections(id),
  id uuid NOT NULL UNIQUE,
  window_id uuid NOT NULL UNIQUE REFERENCES portal_marketing.video_windows(id),
  connection_revision bigint NOT NULL,
  profile_hash text NOT NULL,
  next_token text,
  page_count integer NOT NULL DEFAULT 0 CHECK(page_count BETWEEN 0 AND 200),
  row_count integer NOT NULL DEFAULT 0 CHECK(row_count BETWEEN 0 AND 20000),
  byte_count integer NOT NULL DEFAULT 0 CHECK(byte_count BETWEEN 0 AND 33554432),
  expected_count integer CHECK(expected_count BETWEEN 0 AND 20000),
  latest_date date,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(next_token IS NULL OR length(next_token) BETWEEN 1 AND 2000)
);
CREATE TABLE portal_marketing.video_scan_pages (
  scan_id uuid NOT NULL REFERENCES portal_marketing.video_scans(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 200),
  cursor_hash text NOT NULL,
  page_hash text NOT NULL,
  request_id text NOT NULL,
  PRIMARY KEY(scan_id,ordinal),
  UNIQUE(scan_id,cursor_hash)
);
CREATE TABLE portal_marketing.video_scan_rows (
  scan_id uuid NOT NULL REFERENCES portal_marketing.video_scans(id) ON DELETE CASCADE,
  video_id text NOT NULL,
  creator_id text NOT NULL,
  observation jsonb NOT NULL,
  PRIMARY KEY(scan_id,video_id)
);
