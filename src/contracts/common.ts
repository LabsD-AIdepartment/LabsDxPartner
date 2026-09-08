import { z } from 'zod';
export const Id = z.string().min(1).max(160);
export const Minor = z
  .string()
  .regex(/^(?:0|-?[1-9]\d*)$/)
  .max(40);
export const Money = z.strictObject({ currency: z.literal('THB'), minor: Minor });
export type MoneyValue = z.infer<typeof Money>;
export const Instant = z.iso.datetime({ offset: true });
export const DataState = z.enum(['ready', 'partial', 'stale', 'unavailable']);
export const Period = z
  .strictObject({ from: Instant, toExclusive: Instant, timezone: z.literal('Asia/Bangkok') })
  .refine((v) => Date.parse(v.from) < Date.parse(v.toExclusive), 'Period must be increasing');
export const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Freshness = z.strictObject({
  dataState: DataState,
  generatedAt: Instant,
  dataThrough: Instant.nullable(),
  reasons: z.array(z.string().min(1).max(300)).max(30),
  requestId: Id,
});
export const envelope = <T extends z.ZodType>(data: T) =>
  Freshness.extend({ data, generation: Id, period: Period });
export const page = <T extends z.ZodType>(row: T) =>
  z.strictObject({
    items: z.array(row).max(100),
    nextCursor: z.string().max(1000).nullable(),
    totalCount: Count.nullable(),
  });
export const QueryFilters = z
  .strictObject({
    from: z.iso.date(),
    toExclusive: z.iso.date(),
    brand: Id.nullable(),
    q: z.string().max(160).default(''),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().max(1000).nullable().default(null),
  })
  .refine((v) => {
    const days = (Date.parse(v.toExclusive) - Date.parse(v.from)) / 86400000;
    return days > 0 && days <= 366;
  }, 'Select between 1 and 366 days');
export const ApiError = z.strictObject({
  error: z.strictObject({
    code: z.enum([
      'unauthenticated',
      'forbidden',
      'not_found',
      'generation_changed',
      'conflict',
      'invalid_input',
      'rate_limited',
      'unavailable',
    ]),
    message: z.string().max(300),
    requestId: Id,
    retryable: z.boolean(),
  }),
});
