-- Additive correction to 0002, which is already checksum-locked in the isolated test DB.
-- Empty details on older records mean not captured; never invent prior authorization facts.
ALTER TABLE portal_access.audit ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb
  CONSTRAINT audit_details_object CHECK(jsonb_typeof(details) = 'object');
