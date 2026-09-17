import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ReviewReference as RecordId } from '@/contracts/review-reference';
import { CatalogueSnapshot } from '@/contracts/catalogue';
import { AccountProfile } from '@/contracts/account-profile';
import type { AccountProfileRepository } from '@/server/modules/account/profile';
import { ApprovalContext, INTAKE_LIMITS } from '@/server/adapters/approved-period/schema';
import type { SourceReviewRepository } from '@/server/modules/imports/approval-store';
import type { CatalogueRepository } from '@/server/modules/content/catalogue';
import {
  SourceSettlement,
  type SourceSettlementRepository,
} from '@/server/modules/statements/settlement-source';

export class ReviewedFileFailure extends Error {
  constructor(readonly code: 'invalid_input' | 'unavailable' | 'changed' | 'too_large') {
    super(code);
  }
}
type Folder = 'exports' | 'controls' | 'catalogues' | 'settlements' | 'account-profiles';

/** Operator-provisioned root, mounted read-only to portal processes. No browser path/upload access. */
export function createReviewedFiles(directory: string) {
  if (!isAbsolute(directory)) throw new ReviewedFileFailure('invalid_input');
  async function read(folder: Folder, id: string): Promise<string> {
    if (!RecordId.safeParse(id).success) throw new ReviewedFileFailure('invalid_input');
    try {
      const root = await realpath(directory),
        parent = join(root, folder);
      if ((await realpath(parent)) !== parent) throw new ReviewedFileFailure('unavailable');
      // NONBLOCK prevents a FIFO/device from hanging before the regular-file check.
      const file = await open(
        join(parent, id + '.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await file.stat({ bigint: true });
        if (!before.isFile()) throw new ReviewedFileFailure('unavailable');
        if (before.size > BigInt(INTAKE_LIMITS.bytes)) throw new ReviewedFileFailure('too_large');
        const buffer = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        while (length < buffer.length) {
          const result = await file.read(buffer, length, buffer.length - length, null);
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        const after = await file.stat({ bigint: true });
        if (
          BigInt(length) !== before.size ||
          after.size !== before.size ||
          after.mtimeNs !== before.mtimeNs ||
          after.ctimeNs !== before.ctimeNs
        )
          throw new ReviewedFileFailure('changed');
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
        } catch {
          throw new ReviewedFileFailure('invalid_input');
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof ReviewedFileFailure) throw error;
      throw new ReviewedFileFailure('unavailable');
    }
  }
  async function json(folder: Folder, id: string) {
    try {
      return JSON.parse(await read(folder, id));
    } catch (error) {
      if (error instanceof ReviewedFileFailure) throw error;
      throw new ReviewedFileFailure('invalid_input');
    }
  }
  const periods: SourceReviewRepository = {
    load: async (id) => {
      // Controls are independently provisioned. Neither file alone grants publication authority.
      const raw = await read('exports', id),
        parsed = ApprovalContext.safeParse(await json('controls', id));
      if (!parsed.success) throw new ReviewedFileFailure('invalid_input');
      return { raw, context: parsed.data };
    },
  };
  const catalogues: CatalogueRepository = {
    load: async (partnerId, id) => {
      const parsed = CatalogueSnapshot.safeParse(await json('catalogues', id));
      if (!parsed.success) throw new ReviewedFileFailure('invalid_input');
      if (parsed.data.partnerId !== partnerId) throw new ReviewedFileFailure('changed');
      return parsed.data;
    },
  };
  const settlements: SourceSettlementRepository = {
    load: async (id) => {
      const parsed = SourceSettlement.safeParse(await json('settlements', id));
      if (!parsed.success) throw new ReviewedFileFailure('invalid_input');
      return parsed.data;
    },
  };
  const accountProfiles: AccountProfileRepository = {
    load: async (partnerId, id) => {
      const parsed = AccountProfile.safeParse(await json('account-profiles', id));
      if (!parsed.success) throw new ReviewedFileFailure('invalid_input');
      if (parsed.data.partnerId !== partnerId) throw new ReviewedFileFailure('changed');
      return parsed.data;
    },
  };
  return { periods, catalogues, settlements, accountProfiles };
}
