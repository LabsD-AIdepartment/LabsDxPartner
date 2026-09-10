import { createHash } from 'node:crypto';
import { SourceReadError } from '../source-error';
import { abortable } from './video-transport';

// Integer milli-tokens; one request costs1000. Redis time makes all callers share
// one clock. Both buckets are checked before either request charge is committed.
const RESERVE = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local rates = {tonumber(ARGV[1]), tonumber(ARGV[2])}
local states = {}
local delay = 0
for i, key in ipairs(KEYS) do
  local rate = rates[i]
  if not rate or rate < 1 or rate > 10000 or rate ~= math.floor(rate) then
    return redis.error_reply('invalid quota policy')
  end
  local cap = rate * 1000
  local row = redis.call('HMGET', key, 'tokens', 'at', 'rate')
  local tokens, at = cap, now
  if row[1] or row[2] or row[3] then
    tokens, at = tonumber(row[1]), tonumber(row[2])
    if not tokens or not at or tonumber(row[3]) ~= rate or tokens < 0 or tokens > cap or at < 0 or at > 9007199254740991 or tokens ~= math.floor(tokens) or at ~= math.floor(at) then
      return redis.error_reply('invalid quota state')
    end
    tokens = math.min(cap, tokens + math.max(0, now - at) * rate)
    at = math.max(now, at)
  end
  states[i] = {tokens, at}
  if tokens < 1000 then delay = math.max(delay, math.ceil((1000 - tokens) / rate) + math.max(0, at - now)) end
end
for i, key in ipairs(KEYS) do
  local tokens, at = states[i][1], states[i][2]
  if delay == 0 then tokens = tokens - 1000 end
  redis.call('HSET', key, 'tokens', tokens, 'at', at, 'rate', rates[i])
  redis.call('PEXPIRE', key, math.max(60000, at - now + 60000))
end
if delay == 0 then return {1, 0} end
return {0, delay}
`;
export type TikTokQuotaOptions = {
  appPerSecond: number;
  shopPerSecond: number;
  /** Source ioredis eval port. Configure bounded commandTimeout and no offline queue. */
  eval: (script: string, numberOfKeys: number, ...args: (string | number)[]) => Promise<unknown>;
};
export type TikTokQuotaScope = { appKey: string; shopCipher?: string };
export type TikTokQuotaReservation = { allowed: true } | { allowed: false; retryAfterMs: number };
const identity = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 8192 &&
  !/[\s\u0000-\u001f\u007f]/u.test(value);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Shared source-side governor. Construction never connects; failures never allow.
 * Rate policy must be identical for all callers sharing this app (documented host invariant). */
export function createTikTokQuota(options: TikTokQuotaOptions) {
  if (
    ![options.appPerSecond, options.shopPerSecond].every(
      (n) => Number.isSafeInteger(n) && n >= 1 && n <= 10000,
    ) ||
    options.shopPerSecond > options.appPerSecond ||
    typeof options.eval !== 'function'
  )
    throw new Error('Invalid TikTok quota configuration');
  const appRate = options.appPerSecond,
    shopRate = options.shopPerSecond;
  return {
    async reserve(scope: TikTokQuotaScope, parent: AbortSignal): Promise<TikTokQuotaReservation> {
      parent.throwIfAborted();
      if (
        !identity(scope.appKey) ||
        (scope.shopCipher !== undefined && !identity(scope.shopCipher))
      )
        throw new SourceReadError('access');
      // Hash tag keeps both keys on one Redis Cluster slot. One stable namespace
      // across app instances/processes; never include Portal partner IDs in quota scope.
      const prefix = `labsd:tts:quota:v1:{${digest(scope.appKey)}}`;
      const keys = [
        `${prefix}:app`,
        ...(scope.shopCipher ? [`${prefix}:shop:${digest(scope.shopCipher)}`] : []),
      ];
      const signal = AbortSignal.any([parent, AbortSignal.timeout(2000)]);
      try {
        const result = await abortable(
          options.eval(RESERVE, keys.length, ...keys, appRate, shopRate),
          signal,
        );
        signal.throwIfAborted();
        if (
          !Array.isArray(result) ||
          result.length !== 2 ||
          !Number.isSafeInteger(result[0]) ||
          !Number.isSafeInteger(result[1])
        )
          throw new Error('Invalid reservation');
        if (result[0] === 1 && result[1] === 0) return { allowed: true };
        if (result[0] === 0 && result[1] > 0) return { allowed: false, retryAfterMs: result[1] };
        throw new Error('Invalid reservation');
      } catch {
        parent.throwIfAborted();
        throw new SourceReadError('temporary');
      }
    },
  };
}
