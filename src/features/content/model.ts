import { partnerFilters } from '@/shared/config/partner-features';
import { z } from 'zod';
import {
  ContentListResponse,
  ContentDetailResponse,
  AdListResponse,
  AdDetailResponse,
} from '@/contracts/content';
import { EarningsResponse } from '@/contracts/earnings';
import type { QueryScope } from '@/shared/query/keys';
import { validContentFilters, type ReportContext } from '@/shared/routing/report-context';
export type Resource = 'list' | 'detail' | 'earnings' | 'ads' | 'ad';
export type ContentRequest = {
  resource: Resource;
  scope: QueryScope;
  context: ReportContext;
  contentId?: string;
  adId?: string;
  cursor?: string | null;
  signal: AbortSignal;
};
export type ContentTransport = (request: ContentRequest) => Promise<unknown>;
/** A cursor belongs to the filter scope which issued it. Discard it only when that scope changes. */
export function normalizeContentRequest<
  T extends { context: ReportContext; cursor?: string | null },
>(request: T): T {
  const context = partnerFilters(request.context);
  return context === request.context ? request : { ...request, context, cursor: null };
}

export class ContentError extends Error {
  constructor(
    public code: 'generation_changed' | 'not_found' | 'invalid_response' | 'invalid_input',
    message: string,
  ) {
    super(message);
  }
}
const schemas = {
  list: ContentListResponse,
  detail: ContentDetailResponse,
  earnings: EarningsResponse,
  ads: AdListResponse,
  ad: AdDetailResponse,
};
export type ContentResponse<K extends Resource> = z.infer<(typeof schemas)[K]>;
export async function loadContent<K extends Resource>(
  transport: ContentTransport,
  request: ContentRequest & { resource: K },
): Promise<ContentResponse<K>> {
  request = normalizeContentRequest(request);
  if (!validContentFilters(request.context))
    throw new ContentError(
      'invalid_input',
      'เลือกช่วงวันที่ 1–366 วัน และคำค้นไม่เกิน 160 ตัวอักษร',
    );
  const parsed = schemas[request.resource].safeParse(await transport(request));
  if (!parsed.success)
    throw new ContentError('invalid_response', 'ข้อมูลต้นทางไม่ครบตามรูปแบบที่กำหนด');
  const result = parsed.data;
  if (request.context.generation && result.generation !== request.context.generation)
    throw new ContentError(
      'generation_changed',
      'มีข้อมูลรายได้รุ่นใหม่ กรุณาเปิดภาพรวมล่าสุดก่อนตรวจสอบต่อ',
    );
  if (
    Date.parse(result.period.from) !== Date.parse(request.context.from + 'T00:00:00+07:00') ||
    Date.parse(result.period.toExclusive) !==
      Date.parse(request.context.toExclusive + 'T00:00:00+07:00')
  )
    throw new ContentError('invalid_response', 'ช่วงเวลาของข้อมูลไม่ตรงกับที่เลือก');
  const mismatch = () => {
    throw new ContentError('invalid_response', 'ข้อมูลไม่ตรงกับคลิปหรือโฆษณาที่เลือก');
  };
  if (request.resource === 'detail') {
    const data = (result as ContentResponse<'detail'>).data;
    if (
      data.content.id !== request.contentId ||
      (request.context.brand && data.content.brand !== request.context.brand)
    )
      mismatch();
  }
  if (
    request.resource === 'list' &&
    request.context.brand &&
    (result as ContentResponse<'list'>).data.items.some((x) => x.brand !== request.context.brand)
  )
    mismatch();
  if (request.resource === 'ad') {
    const data = (result as ContentResponse<'ad'>).data;
    if (data.id !== request.adId || data.contentId !== request.contentId) mismatch();
    if (
      data.performance &&
      (Date.parse(data.performance.period.from) !== Date.parse(result.period.from) ||
        Date.parse(data.performance.period.toExclusive) !== Date.parse(result.period.toExclusive))
    )
      mismatch();
  }
  if (
    request.resource === 'ads' &&
    (result as ContentResponse<'ads'>).data.items.some((x) => x.contentId !== request.contentId)
  )
    mismatch();
  if (
    request.resource === 'earnings' &&
    (result as ContentResponse<'earnings'>).data.items.some(
      (x) =>
        x.contentId !== request.contentId ||
        x.attribution !== 'content' ||
        Date.parse(x.earnedAt) < Date.parse(result.period.from) ||
        Date.parse(x.earnedAt) >= Date.parse(result.period.toExclusive),
    )
  )
    mismatch();
  if ('items' in result.data) {
    const ids = result.data.items.map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      throw new ContentError('invalid_response', 'รายการต้นทางซ้ำกัน กรุณาโหลดข้อมูลใหม่');
  }
  return result as ContentResponse<K>;
}
export const resourceKey = (
  r: Resource,
  c: ReportContext,
  contentId?: string,
  adId?: string,
  cursor?: string | null,
) => {
  const normalized = normalizeContentRequest({ context: c, cursor });
  c = normalized.context;
  return {
    resource: r,
    from: c.from,
    toExclusive: c.toExclusive,
    brand: partnerFilters(c).brand,
    q: c.q,
    cursor: normalized.cursor === undefined ? c.cursor : normalized.cursor,
    contentId: contentId ?? null,
    adId: adId ?? null,
  };
};
