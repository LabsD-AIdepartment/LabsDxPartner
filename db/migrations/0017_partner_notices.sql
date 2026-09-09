-- Additive; depends on0016 and0015 metadata. No financial rows are rewritten.
-- Source history and triggers are installed under the same migration transaction.
LOCK TABLE portal_statements.statements,portal_statements.settlements,portal_statements.allocations IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE portal_statements.notice_sources (
  position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partner_id text NOT NULL,
  statement_id uuid NOT NULL,
  settlement_id uuid,
  UNIQUE NULLS NOT DISTINCT(statement_id,settlement_id),
  FOREIGN KEY(partner_id,statement_id) REFERENCES portal_statements.statements(partner_id,id),
  FOREIGN KEY(partner_id,settlement_id) REFERENCES portal_statements.settlements(partner_id,id)
);
CREATE INDEX notice_partner_position ON portal_statements.notice_sources(partner_id,position DESC);
CREATE TABLE portal_access.notice_seen (
  partner_id text NOT NULL,
  user_id text NOT NULL,
  through_position bigint NOT NULL CHECK(through_position>0),
  PRIMARY KEY(partner_id,user_id),
  FOREIGN KEY(partner_id,user_id) REFERENCES portal_access.memberships(partner_id,user_id),
  FOREIGN KEY(through_position) REFERENCES portal_statements.notice_sources(position)
);
INSERT INTO portal_statements.notice_sources(partner_id,statement_id,settlement_id)
SELECT partner_id,statement_id,settlement_id FROM (
  SELECT partner_id,id AS statement_id,NULL::uuid AS settlement_id,published_at AS at
  FROM portal_statements.statements
  UNION ALL
  SELECT a.partner_id,a.statement_id,a.settlement_id,s.recorded_at AS at
  FROM portal_statements.allocations a JOIN portal_statements.settlements s
    ON s.partner_id=a.partner_id AND s.id=a.settlement_id
) history ORDER BY at,statement_id,settlement_id NULLS FIRST;
INSERT INTO portal_meta.partner_changes(partner_id,notices)
SELECT partner_id,count(*) FROM portal_statements.notice_sources GROUP BY partner_id
ON CONFLICT(partner_id) DO UPDATE SET notices=portal_meta.partner_changes.notices+excluded.notices,published_at=clock_timestamp();
CREATE FUNCTION portal_statements.index_partner_notice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Same partner lock as publication/settlement writers; acquire BEFORE sequence allocation.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.partner_id,981709));
  IF TG_TABLE_NAME='statements' THEN
    INSERT INTO portal_statements.notice_sources(partner_id,statement_id)
      VALUES(NEW.partner_id,NEW.id);
  ELSE
    INSERT INTO portal_statements.notice_sources(partner_id,statement_id,settlement_id)
      VALUES(NEW.partner_id,NEW.statement_id,NEW.settlement_id);
  END IF;
  INSERT INTO portal_meta.partner_changes(partner_id,notices) VALUES(NEW.partner_id,1)
    ON CONFLICT(partner_id) DO UPDATE SET notices=portal_meta.partner_changes.notices+1,published_at=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER statement_notice AFTER INSERT ON portal_statements.statements
FOR EACH ROW EXECUTE FUNCTION portal_statements.index_partner_notice();
CREATE TRIGGER allocation_notice AFTER INSERT ON portal_statements.allocations
FOR EACH ROW EXECUTE FUNCTION portal_statements.index_partner_notice();
CREATE TRIGGER notice_source_immutable BEFORE UPDATE OR DELETE ON portal_statements.notice_sources
FOR EACH ROW EXECUTE FUNCTION portal_statements.immutable_finance_record();
