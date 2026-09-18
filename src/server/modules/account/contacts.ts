import { z } from 'zod';
import { ContactQuery, ContactSave, ContactSnapshot } from '@/contracts/account-contact';
import { PartnerCapability } from '@/contracts/access';
import { AccessFailure, type createPartnerAccess, type PartnerScope } from '../partners/access';
import type { TransactionSql } from 'postgres';

export function createAccountContacts(access: ReturnType<typeof createPartnerAccess>) {
  async function scoped<T>(
    headers: Headers,
    query: z.infer<typeof ContactQuery>,
    run: (tx: TransactionSql, scope: PartnerScope) => Promise<T>,
  ) {
    const session = await access.session(headers, query.partnerId);
    const member = session.memberships.find((value) => value.partnerId === query.partnerId);
    const capability = member?.capabilities.find(
      (value) => PartnerCapability.safeParse(value).success,
    );
    if (!capability) throw new AccessFailure('forbidden');
    return access.withPartner(
      headers,
      query.partnerId,
      PartnerCapability.parse(capability),
      async (tx, scope) => {
        if (scope.permissionRevision !== query.permissionRevision)
          throw new AccessFailure('conflict');
        return run(tx, scope);
      },
    );
  }
  function snapshot(
    scope: PartnerScope,
    row?: { email: string | null; phone: string | null; revision: string },
  ) {
    return ContactSnapshot.parse({
      userId: scope.userId,
      partnerId: scope.partnerId,
      permissionRevision: scope.permissionRevision,
      revision: row?.revision ?? '0',
      contact: { email: row?.email ?? null, phone: row?.phone ?? null },
      verification: 'unverified',
    });
  }
  return {
    read(headers: Headers, input: unknown) {
      return scoped(headers, ContactQuery.parse(input), async (tx, scope) => {
        const [row] = await tx`select email,phone,revision::text from portal_access.account_contacts
          where partner_id=${scope.partnerId} and user_id=${scope.userId}`;
        return snapshot(scope, row as Parameters<typeof snapshot>[1]);
      });
    },
    save(headers: Headers, input: unknown) {
      const command = ContactSave.parse(input);
      return scoped(headers, command, async (tx, scope) => {
        // A different browser tab may have switched the signed-in account since the form loaded.
        // This is an expectation check, never caller authority to choose the target user.
        if (scope.userId !== command.expectedUserId) throw new AccessFailure('conflict');
        // CAS includes first creation: competing revision-0 writes cannot overwrite one another.
        const rows =
          command.expectedRevision === '0'
            ? await tx`insert into portal_access.account_contacts(partner_id,user_id,email,phone)
              values(${scope.partnerId},${scope.userId},${command.contact.email},${command.contact.phone})
              on conflict(partner_id,user_id) do nothing returning email,phone,revision::text`
            : await tx`update portal_access.account_contacts set email=${command.contact.email},
              phone=${command.contact.phone},revision=revision+1,updated_at=clock_timestamp()
              where partner_id=${scope.partnerId} and user_id=${scope.userId}
              and revision=${command.expectedRevision}::bigint returning email,phone,revision::text`;
        if (!rows[0]) throw new AccessFailure('conflict');
        return snapshot(scope, rows[0] as Parameters<typeof snapshot>[1]);
      });
    },
  };
}
