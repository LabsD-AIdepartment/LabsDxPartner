import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// Separate logical schema; only identity owns these maintained-library tables.
const identity = pgSchema('portal_identity');
const date = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = () => ({
  createdAt: date('created_at').defaultNow().notNull(),
  updatedAt: date('updated_at').defaultNow().notNull(),
});
export const user = identity.table('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  ...timestamps(),
});
export const session = identity.table(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: date('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestamps(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expiry_idx').on(t.expiresAt)],
);
export const account = identity.table(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: date('access_token_expires_at'),
    refreshTokenExpiresAt: date('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('accounts_provider_subject_uq').on(t.providerId, t.accountId),
    index('accounts_user_idx').on(t.userId),
  ],
);
export const verification = identity.table(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: date('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('verifications_identifier_uq').on(t.identifier),
    index('verifications_expiry_idx').on(t.expiresAt),
  ],
);
export const rateLimit = identity.table('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
export const binding = identity.table('binding', {
  id: text('id').primaryKey(),
  namespaceDigest: text('namespace_digest').notNull(),
  createdAt: date('created_at').defaultNow().notNull(),
});
// Application-owned history, deliberately excluded from the maintained authSchema mapping.
export const methodAudit = identity.table(
  'method_audit',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    targetId: text('target_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    result: jsonb('result').notNull(),
    details: jsonb('details').notNull(),
    createdAt: date('created_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('method_audit_actor_id_idempotency_key_key').on(t.actorId, t.idempotencyKey),
    index('method_audit_actor_time_idx').on(t.actorId, t.createdAt),
  ],
);
export const authSchema = { user, session, account, verification, rateLimit };
