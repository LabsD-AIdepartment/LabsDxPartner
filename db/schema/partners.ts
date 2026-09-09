import { sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  bigint,
  timestamp,
  boolean,
  jsonb,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { user } from './identity';

const access = pgSchema('portal_access');
const date = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const partners = access.table(
  'partners',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    revision: bigint('revision', { mode: 'bigint' }).notNull().default(1n),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('partner_status', sql`${t.status} IN ('active','suspended')`),
    check('partner_name', sql`length(${t.name}) BETWEEN 1 AND 200`),
    check('partner_revision', sql`${t.revision} > 0`),
  ],
);
export const memberships = access.table(
  'memberships',
  {
    id: text('id').primaryKey(),
    partnerId: text('partner_id')
      .notNull()
      .references(() => partners.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    status: text('status').notNull(),
    capabilities: text('capabilities')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    permissionRevision: bigint('permission_revision', { mode: 'bigint' }).notNull().default(1n),
    verifiedContactRef: text('verified_contact_ref'),
    createdAt: date('created_at').notNull().defaultNow(),
    updatedAt: date('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.partnerId, t.userId),
    index('memberships_user_idx').on(t.userId, t.partnerId),
    check('member_status', sql`${t.status} IN ('pending','active','suspended')`),
    check(
      'member_capabilities',
      sql`${t.capabilities} <@ ARRAY['view_earnings','view_content','view_statements','view_ad_spend']::text[] AND cardinality(${t.capabilities}) <= 4`,
    ),
    check(
      'member_active_verified',
      sql`${t.status} <> 'active' OR (${t.verifiedContactRef} IS NOT NULL AND length(${t.verifiedContactRef}) > 0 AND cardinality(${t.capabilities}) > 0)`,
    ),
    check('member_revision', sql`${t.permissionRevision} > 0`),
  ],
);
export const staffGrants = access.table(
  'staff_grants',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id),
    capabilities: text('capabilities').array().notNull(),
    active: boolean('active').notNull(),
    provisionRef: text('provision_ref').notNull(),
    revision: bigint('revision', { mode: 'bigint' }).notNull().default(1n),
  },
  (t) => [
    check(
      'staff_caps',
      sql`${t.capabilities} <@ ARRAY['manage_partners','review_imports','publish_statements','record_payments']::text[]`,
    ),
    check('staff_provision', sql`length(${t.provisionRef}) > 0`),
    check('staff_revision', sql`${t.revision} > 0`),
  ],
);
export const invites = access.table(
  'invites',
  {
    id: text('id').primaryKey(),
    partnerId: text('partner_id')
      .notNull()
      .references(() => partners.id),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: date('expires_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: date('created_at').notNull().defaultNow(),
    revokedAt: date('revoked_at'),
    claimedAt: date('claimed_at'),
    claimedBy: text('claimed_by').references(() => user.id),
    recipientName: text('recipient_name'),
    verifiedContactRef: text('verified_contact_ref'),
    capabilities: text('capabilities').array(),
  },
  (t) => [
    index('invites_partner_idx').on(t.partnerId, t.createdAt, t.id),
    check('invite_hash', sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('invite_claim', sql`(${t.claimedAt} IS NULL) = (${t.claimedBy} IS NULL)`),
    check('invite_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
export const accessAudit = access.table(
  'audit',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    partnerId: text('partner_id')
      .notNull()
      .references(() => partners.id),
    targetId: text('target_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').notNull(),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: date('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.actorId, t.idempotencyKey),
    index('audit_partner_idx').on(t.partnerId, t.createdAt, t.id),
    check('audit_hash', sql`${t.requestHash} ~ '^[a-f0-9]{64}$'`),
    check('audit_details_object', sql`jsonb_typeof(${t.details}) = 'object'`),
  ],
);
// Append-only audit trigger is deliberately migration-owned; Drizzle does not express triggers.
