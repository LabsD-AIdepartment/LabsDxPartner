import { ContentHttpResponse } from '@/contracts/content-http';
import { AccessLost } from '@/shared/query/revision-watcher';
import { SourceUnavailableError } from '@/shared/query/source-unavailable';
import { ContentError, type ContentTransport } from './model';

export const contentHttp: ContentTransport = async ({
  scope,
  context,
  resource,
  contentId,
  adId,
  cursor,
  signal,
}) => {
  const params = new URLSearchParams({
    partnerId: scope.partnerId,
    permissionRevision: scope.permissionRevision,
    resource,
    from: context.from,
    toExclusive: context.toExclusive,
    q: context.q,
  });
  for (const [key, value] of Object.entries({
    brand: context.brand,
    generation: context.generation,
    contentId,
    adId,
    cursor: cursor ?? undefined,
  }))
    if (value) params.set(key, value);
  const response = await fetch('/api/v1/partner/content?' + params, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (response.status === 401 || response.status === 403)
    throw new AccessLost('Content access changed');
  if (response.status === 409)
    throw new ContentError('generation_changed', 'มีข้อมูลรุ่นใหม่ กรุณาเปิดภาพรวมล่าสุด');
  if (response.status === 404) throw new ContentError('not_found', 'ไม่พบคลิปหรือโฆษณาที่เลือก');
  if (response.status === 503) throw new SourceUnavailableError();
  if (!response.ok) throw new Error('Content unavailable');
  const data = ContentHttpResponse.parse(await response.json());
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (data.partnerId !== scope.partnerId || data.permissionRevision !== scope.permissionRevision)
    throw new AccessLost('Content response scope changed');
  if (
    data.resource !== resource ||
    data.brand !== context.brand ||
    data.q !== context.q ||
    data.contentId !== (contentId ?? null) ||
    data.adId !== (adId ?? null)
  )
    throw new ContentError('invalid_response', 'ข้อมูลไม่ตรงกับรายการที่เลือก');
  return data.result;
};
