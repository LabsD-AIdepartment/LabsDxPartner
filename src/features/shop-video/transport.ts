import type { z } from 'zod';
import {
  PartnerShopVideoQuery,
  PartnerShopVideos,
  ShopVideoOptions,
  ShopVideoReceipt,
  ShopVideoSaved,
  type ShopVideoLookup,
  type ShopVideoSave,
} from '@/contracts/shop-video';
import type { RegistrationScopeValue } from '@/contracts/ad-registration';
export class VideoRequestError extends Error {
  constructor(public status: number) {
    super(
      status === 401 || status === 403
        ? 'สิทธิ์เปลี่ยน กรุณายืนยันตัวตนอีกครั้ง'
        : status === 409
          ? 'ข้อมูลเปลี่ยนหรือไม่พบวิดีโอในรายงานล่าสุด กรุณาค้นหาใหม่'
          : 'ข้อมูล TikTok ยังไม่พร้อม กรุณาลองอีกครั้งภายหลัง',
    );
  }
}
async function request(url: string, signal: AbortSignal, body?: unknown) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new VideoRequestError(response.status);
  const data: unknown = await response.json();
  signal.throwIfAborted();
  return data;
}
export type VideoReadRequest = z.infer<typeof PartnerShopVideoQuery>;
export type VideoReadTransport = (query: VideoReadRequest, signal: AbortSignal) => Promise<unknown>;
export const nativeVideoRead: VideoReadTransport = (query, signal) =>
  request('/api/v1/partner/content/shop-videos?' + new URLSearchParams(query), signal);
export async function loadShopVideos(
  transport: VideoReadTransport,
  query: VideoReadRequest,
  signal: AbortSignal,
) {
  PartnerShopVideoQuery.parse(query);
  const value = PartnerShopVideos.parse(await transport({ ...query }, signal));
  signal.throwIfAborted();
  if (
    value.partnerId !== query.partnerId ||
    value.permissionRevision !== query.permissionRevision ||
    value.clipId !== query.clipId ||
    value.period.from !== query.from ||
    value.period.toExclusive !== query.toExclusive ||
    new Set(value.items.map((i) => i.id)).size !== value.items.length
  )
    throw new VideoRequestError(409);
  for (const item of value.items) {
    let end = query.from;
    for (const row of item.performance.series) {
      if (row.period.from < end || row.period.toExclusive > query.toExclusive)
        throw new VideoRequestError(409);
      end = row.period.toExclusive;
    }
  }
  return value;
}
export type VideoRegistrationTransport = {
  options(scope: RegistrationScopeValue & { q?: string }, signal: AbortSignal): Promise<unknown>;
  lookup(query: z.infer<typeof ShopVideoLookup>, signal: AbortSignal): Promise<unknown>;
  save(query: z.infer<typeof ShopVideoSave>, signal: AbortSignal): Promise<unknown>;
};
export const nativeVideoRegistration: VideoRegistrationTransport = {
  options: (q, s) => request('/api/v1/staff/shop-videos?' + new URLSearchParams(q), s),
  lookup: (q, s) => request('/api/v1/staff/shop-videos/lookup', s, q),
  save: (q, s) => request('/api/v1/staff/shop-videos/save', s, q),
};
export async function loadVideoOptions(
  transport: VideoRegistrationTransport,
  scope: RegistrationScopeValue & { q?: string },
  signal: AbortSignal,
) {
  const result = ShopVideoOptions.parse(await transport.options({ ...scope }, signal));
  signal.throwIfAborted();
  if (
    result.actorId !== scope.actorId ||
    result.permissionRevision !== scope.permissionRevision ||
    result.q !== (scope.q ?? '').trim() ||
    [result.targets, result.connections].some(
      (rows) => new Set(rows.map((r) => r.id)).size !== rows.length,
    )
  )
    throw new VideoRequestError(403);
  return result;
}
export async function lookupVideo(
  transport: VideoRegistrationTransport,
  query: z.infer<typeof ShopVideoLookup>,
  signal: AbortSignal,
) {
  const result = ShopVideoReceipt.parse(await transport.lookup({ ...query }, signal));
  signal.throwIfAborted();
  if (Object.entries(query).some(([k, v]) => result[k as keyof typeof query] !== v))
    throw new VideoRequestError(409);
  return result;
}
export async function saveVideo(
  transport: VideoRegistrationTransport,
  query: z.infer<typeof ShopVideoSave>,
  target: { partnerId: string; clipId: string },
  signal: AbortSignal,
) {
  const result = ShopVideoSaved.parse(await transport.save({ ...query }, signal));
  signal.throwIfAborted();
  if (
    result.partnerId !== target.partnerId ||
    result.clipId !== target.clipId ||
    result.videoId !== query.videoId
  )
    throw new VideoRequestError(409);
  return result;
}
