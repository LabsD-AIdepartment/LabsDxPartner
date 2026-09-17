-- Additive; depends on 0021. SOLO local allocation, recheck target/main before release.
-- This bounds recurring acquisition, never retention of stored reports.
ALTER TABLE portal_marketing.sync_jobs ADD COLUMN refresh_from timestamptz;
ALTER TABLE portal_marketing.sync_jobs ADD COLUMN plan_as_of timestamptz;
ALTER TABLE portal_marketing.sync_jobs ADD CONSTRAINT marketing_plan_pair
  CHECK ((refresh_from IS NULL) = (plan_as_of IS NULL));
CREATE INDEX report_windows_job_period ON portal_marketing.report_windows(job_id,period_to,id);
