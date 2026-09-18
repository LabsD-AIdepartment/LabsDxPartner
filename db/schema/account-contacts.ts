import { sql } from 'drizzle-orm';
import {
  pgSchema,
  text,
  bigint,
  timestamp,
  primaryKey,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { memberships } from './partners';

export const accountContacts = pgSchema('portal_access').table(
  'account_contacts',
  {
    partnerId: text('partner_id').notNull(),
    userId: text('user_id').notNull(),
    email: text('email'),
    phone: text('phone'),
    revision: bigint('revision', { mode: 'bigint' }).notNull().default(1n),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.partnerId, t.userId] }),
    foreignKey({
      columns: [t.partnerId, t.userId],
      foreignColumns: [memberships.partnerId, memberships.userId],
    }),
    check('contact_revision', sql`${t.revision} > 0`),
    check('contact_email', sql`${t.email} IS NULL OR length(${t.email}) BETWEEN 3 AND 200`),
    check('contact_phone', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+?[0-9]{8,15}$'`),
  ],
);
