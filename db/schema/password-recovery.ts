import { sql } from 'drizzle-orm';
import { bigint, check, index, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './identity';
import { partners } from './partners';

// Application-owned recovery authority. Deliberately outside the maintained authSchema.
const identity = pgSchema('portal_identity');
const date = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const passwordResets = identity.table(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    partnerId: text('partner_id')
      .notNull()
      .references(() => partners.id),
    membershipRevision: bigint('membership_revision', { mode: 'bigint' }).notNull(),
    verifiedContactRef: text('verified_contact_ref').notNull(),
    verificationEvidenceRef: text('verification_evidence_ref').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    issuerRevision: bigint('issuer_revision', { mode: 'bigint' }).notNull(),
    createdAt: date('created_at').notNull().defaultNow(),
    expiresAt: date('expires_at').notNull(),
    consumedAt: date('consumed_at'),
    revokedAt: date('revoked_at'),
  },
  (t) => [
    uniqueIndex('password_resets_pending_user_uq')
      .on(t.userId)
      .where(sql`${t.consumedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    index('password_resets_expiry_idx').on(t.expiresAt),
    check('password_resets_membership_revision_check', sql`${t.membershipRevision}>0`),
    check('password_resets_issuer_revision_check', sql`${t.issuerRevision}>0`),
    check('password_resets_verified_contact_ref_check', sql`length(${t.verifiedContactRef})>0`),
    check(
      'password_resets_verification_evidence_ref_check',
      sql`length(${t.verificationEvidenceRef})>0`,
    ),
    check('password_resets_token_hash_check', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('password_resets_check', sql`${t.expiresAt}>${t.createdAt}`),
  ],
);
