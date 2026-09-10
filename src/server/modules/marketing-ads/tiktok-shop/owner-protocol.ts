import { z } from 'zod';
import { Id } from '@/contracts/common';
import { CompleteVideoCollection, ShopVideoPeriod } from './video-contract';
import { VerifiedShopVideo } from './video-verifier';
import { SourceReadError } from '../source-error';
import { abortable } from './video-transport';
import { ShopVideoPageEvidence, VideoPageToken } from './video-page';

export const OWNER_PATH = '/internal/partner/shop-videos';
// One 2 MB source page plus the fixed owner evidence envelope.
export const OWNER_PAGE_BODY_LIMIT = 2_004_096;
export const OwnerRequest = z.discriminatedUnion('action', [
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal('page'),
    connectionId: Id,
    sourceConnectionRef: Id,
    period: ShopVideoPeriod.refine((p) => {
      const days = (Date.parse(p.toExclusive) - Date.parse(p.from)) / 86400000;
      return days >= 1 && days <= 31;
    }),
    pageToken: VideoPageToken,
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal('verify'),
    connectionId: Id,
    sourceConnectionRef: Id,
  }),
  z.strictObject({
    requestId: z.uuid(),
    action: z.literal('collect'),
    connectionId: Id,
    sourceConnectionRef: Id,
    period: ShopVideoPeriod.refine((p) => {
      const days = (Date.parse(p.toExclusive) - Date.parse(p.from)) / 86400000;
      return days >= 1 && days <= 31;
    }),
  }),
]);
export const OwnerCollection = z.union([
  CompleteVideoCollection,
  z.strictObject({
    ...CompleteVideoCollection.shape,
    completeness: z.literal('partial'),
    reason: z.enum(['source-not-ready', 'page-limit']),
    videos: z.tuple([]),
  }),
]);
export const OwnerResponse = z.discriminatedUnion('action', [
  z.strictObject({ requestId: z.uuid(), action: z.literal('page'), result: ShopVideoPageEvidence }),
  z.strictObject({ requestId: z.uuid(), action: z.literal('verify'), result: VerifiedShopVideo }),
  z.strictObject({ requestId: z.uuid(), action: z.literal('collect'), result: OwnerCollection }),
]);
export const OwnerError = z.strictObject({
  code: z.enum(['access', 'temporary', 'throttled', 'invalid-source']),
  retryAfterMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});
export const ServiceToken = z
  .string()
  .min(32)
  .max(8192)
  .regex(/^[!-~]+$/);

/** No arbitrary error body is surfaced; both peers cap streams before JSON parsing. */
export async function boundedOwnerJson(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
  limit: number,
): Promise<unknown> {
  const reader = body?.getReader();
  if (!reader) throw new SourceReadError('invalid-source');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await abortable(reader.read(), signal);
      signal.throwIfAborted();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) throw new SourceReadError('invalid-source');
      chunks.push(item.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new SourceReadError('invalid-source');
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
