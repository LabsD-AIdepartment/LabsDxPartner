-- Add opaque cursor metadata without changing existing financial values or line references.
ALTER TABLE portal_imports.earning_rows ADD COLUMN row_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX earning_rows_cursor_id ON portal_imports.earning_rows(row_id);
CREATE INDEX earning_rows_cursor ON portal_imports.earning_rows(generation_id,earned_at,row_id);
