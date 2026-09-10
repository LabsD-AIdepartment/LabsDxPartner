import { z } from 'zod';
import type { VideoPeriod } from './video-contract';

export const VideoSchedulePolicy = z.strictObject({
  historyDays: z.number().int().min(1).max(366).default(90),
  recentDays: z.number().int().min(1).max(366).default(7),
  recentSeconds: z.number().int().min(60).max(604800).default(3600),
  historySeconds: z.number().int().min(60).max(604800).default(86400),
});

/** Shop civil dates, not rolling UTC24h intervals. Current shop day is excluded (T-1). */
export function videoDailySchedule(timezone: string, asOf: number, rawPolicy: unknown = {}) {
  z.number().finite().parse(asOf);
  const policy = VideoSchedulePolicy.parse(rawPolicy);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(asOf)
      .map(({ type, value }) => [type, value]),
  );
  const base = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const date = (age: number) => new Date(base - age * 86400000).toISOString().slice(0, 10);
  const windows = Array.from({ length: policy.historyDays }, (_, index) => ({
    period: { from: date(index + 1), toExclusive: date(index) } satisfies VideoPeriod,
    refreshSeconds: index < policy.recentDays ? policy.recentSeconds : policy.historySeconds,
  }));
  return { from: date(policy.historyDays), toExclusive: date(0), windows };
}

export function videoFailurePolicy(reason: string, attempt: number, providerMinimumMs: number) {
  // Configuration/source-shape issues and the collector cap cannot heal by hammering the API.
  const paused = ['access', 'invalid-source', 'page-limit'].includes(reason);
  const delayMs = Math.max(
    providerMinimumMs,
    Math.min(3600000, 60000 * 2 ** Math.min(attempt - 1, 6)),
  );
  return { paused, delayMs };
}
