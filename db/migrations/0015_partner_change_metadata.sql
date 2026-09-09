-- Additive metadata only; depends on0014 and the existing financial/access tables.
-- Enable polling only after all owning writers run the companion code.
CREATE TABLE portal_meta.partner_changes (
  partner_id text PRIMARY KEY REFERENCES portal_access.partners(id),
  earnings numeric(40,0) NOT NULL DEFAULT 0 CHECK(earnings >= 0),
  settlements numeric(40,0) NOT NULL DEFAULT 0 CHECK(settlements >= 0),
  metrics numeric(40,0) NOT NULL DEFAULT 0 CHECK(metrics >= 0),
  notices numeric(40,0) NOT NULL DEFAULT 0 CHECK(notices >= 0),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One-time baseline; no monetary rows or amounts are changed or read.
INSERT INTO portal_meta.partner_changes(partner_id,earnings,settlements,published_at)
SELECT p.id,coalesce(g.count,0)+coalesce(r.statements,0),
  coalesce(r.statements,0)+coalesce(r.settlements,0),
  greatest(coalesce(g.published_at,p.created_at),coalesce(r.updated_at,p.created_at))
FROM portal_access.partners p
LEFT JOIN (
  SELECT s.partner_id,count(*) AS count,max(g.created_at) AS published_at
  FROM portal_imports.scopes s JOIN portal_imports.generations g ON g.scope_id=s.id
  GROUP BY s.partner_id
) g ON g.partner_id=p.id
LEFT JOIN portal_statements.revisions r ON r.partner_id=p.id;
