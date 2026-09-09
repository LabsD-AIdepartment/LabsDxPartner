-- Nullable fields retain legacy invitations without treating them as preapproved setup links.
ALTER TABLE portal_access.invites
  ADD COLUMN recipient_name text,
  ADD COLUMN verified_contact_ref text,
  ADD COLUMN capabilities text[];
ALTER TABLE portal_access.invites ADD CONSTRAINT invite_preapproval CHECK (
  (recipient_name IS NULL AND verified_contact_ref IS NULL AND capabilities IS NULL)
  OR
  (recipient_name IS NOT NULL AND length(recipient_name) BETWEEN 1 AND 200
   AND verified_contact_ref IS NOT NULL AND length(verified_contact_ref) > 0
   AND capabilities IS NOT NULL AND cardinality(capabilities) BETWEEN 1 AND 4
   AND capabilities <@ ARRAY['view_earnings','view_content','view_statements','view_ad_spend']::text[])
);
