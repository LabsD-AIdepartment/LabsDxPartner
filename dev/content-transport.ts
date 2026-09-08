import { ContentError, type ContentTransport, type ContentRequest } from '@/features/content/model';
import { overviewRows } from './overview-transport';
import { money, at } from './scenarios/ready';
import type { ScenarioName } from './scenarios';
export type ContentMode = ScenarioName | 'removed' | 'error' | 'loading' | 'generation-changed';
export function contentFixture(
  request: Omit<ContentRequest, 'signal'>,
  mode: ContentMode = 'ready',
) {
  const name: ScenarioName = ['partial', 'empty', 'stale', 'unavailable', 'adjustments'].includes(
    mode,
  )
    ? (mode as ScenarioName)
    : 'ready';
  const { s, rows, bySource } = overviewRows(request.context, name);
  const sum = (values: typeof rows) =>
    money(values.reduce((n, x) => n + BigInt(x.amount.minor), 0n).toString());
  const period = {
    from: request.context.from + 'T00:00:00+07:00',
    toExclusive: request.context.toExclusive + 'T00:00:00+07:00',
    timezone: 'Asia/Bangkok' as const,
  };
  const envelope = {
    dataState: s.overview.dataState,
    generatedAt: at,
    dataThrough: name === 'stale' ? '2026-08-31T00:00:00+07:00' : s.overview.dataThrough,
    reasons: s.overview.reasons,
    requestId: 'synthetic-content-request',
    generation: mode === 'generation-changed' ? '2' : '1',
    period,
  };
  const forClip = (id: string) => rows.filter((x) => x.contentId === id);
  const unmapped = (id: string) =>
    rows.some((x) => x.attribution === 'partner-only' && bySource.get(x.sourceRef)?.id === id);
  const cards = (name === 'empty' ? [] : s.content.data.items).map((x) => ({
    ...x,
    removed: mode === 'removed' || x.removed,
    earned: unmapped(x.id) ? null : sum(forClip(x.id).filter((x) => x.status !== 'estimated')),
    unavailableReason: unmapped(x.id)
      ? 'ต้นทางระบุรายได้ระดับพาร์ทเนอร์ ยังจับคู่กับคลิปนี้ไม่ได้'
      : null,
  }));
  const paginate = <T>(items: T[]) => {
    const raw = request.cursor === undefined ? request.context.cursor : request.cursor;
    const offset = raw && /^offset-\d+$/.test(raw) ? Number(raw.slice(7)) : 0;
    if (raw && !/^offset-\d+$/.test(raw))
      throw new ContentError('invalid_input', 'หน้ารายการหมดอายุ กรุณากลับหน้าแรก');
    const limit = request.resource === 'list' ? 24 : 2;
    return {
      items: items.slice(offset, offset + limit),
      nextCursor: offset + limit < items.length ? `offset-${offset + limit}` : null,
      totalCount: items.length,
    };
  };
  if (request.resource === 'list') {
    const items = cards.filter(
      (x) =>
        (!request.context.brand || x.brand === request.context.brand) &&
        `${x.title} ${x.brand}`
          .toLocaleLowerCase()
          .includes(request.context.q.toLocaleLowerCase()) &&
        (forClip(x.id).length ||
          unmapped(x.id) ||
          (x.publishedAt.slice(0, 10) >= request.context.from &&
            x.publishedAt.slice(0, 10) < request.context.toExclusive)),
    );
    return { ...envelope, data: paginate(items) };
  }
  const clip = cards.find((x) => x.id === request.contentId);
  if (!clip || (request.context.brand && clip.brand !== request.context.brand))
    throw new ContentError('not_found', 'ไม่พบคลิปนี้ หรือไม่อยู่ในแบรนด์ที่เลือก');
  const selected = forClip(clip.id);
  const metric = (
    key:
      | 'impressions'
      | 'video_views'
      | 'link_clicks'
      | 'reach'
      | 'platform_orders'
      | 'platform_value'
      | 'spend'
      | 'roas',
    value: number | null,
    definition: string,
  ) => ({
    key,
    value,
    unit: ['spend', 'platform_value'].includes(key) ? 'THB' : key === 'roas' ? 'ratio' : 'count',
    definition,
    source: 'Meta · ตัวอย่างข้อมูล',
    period,
    dataThrough: envelope.dataThrough,
    unavailableReason: value === null ? 'ต้นทางยังไม่ส่งข้อมูลนี้' : null,
    additive: key !== 'reach' && key !== 'roas',
  });
  const ads = Array.from({ length: 3 }, (_, i) => ({
    id: `${clip.id}-ad-${i + 1}`,
    contentId: clip.id,
    title: `${clip.brand} · ${['วิดีโอหลัก', 'กลุ่มผู้ชมเพิ่มเติม', 'ทดสอบข้อความ'][i]}`,
    status: clip.removed ? 'removed' : i === 2 ? 'paused' : 'active',
    asOf: at,
    metrics: [
      metric(
        'impressions',
        i === 0 ? 81200 : 36000,
        'จำนวนครั้งที่โฆษณาแสดง อาจนับคนเดิมได้หลายครั้ง',
      ),
      metric(
        'link_clicks',
        i === 0 ? 1240 : 480,
        'การคลิกลิงก์ตามรายงานแพลตฟอร์ม ไม่ใช่จำนวนคำสั่งซื้อ',
      ),
      metric('reach', null, 'จำนวนคนที่เข้าถึงในช่วงเวลานี้ ห้ามบวกข้ามโฆษณา'),
      metric(
        'platform_orders',
        i === 0 ? 84 : 29,
        'คำสั่งซื้อที่แพลตฟอร์มนับตาม attribution window อาจต่างจากออเดอร์ที่เข้าเงื่อนไขจ่าย',
      ),
      metric(
        'platform_value',
        i === 0 ? 128000 : 47000,
        'มูลค่าที่แพลตฟอร์มรายงาน ไม่ใช่ฐานคำนวณหรือคอมมิชชันพร้อมจ่าย',
      ),
      metric('spend', i === 0 ? 9000 : 4000, 'ค่าโฆษณาของแบรนด์ ไม่ได้หักจากคอมมิชชันโดยอัตโนมัติ'),
      metric('roas', null, 'มูลค่าที่แพลตฟอร์มรายงานเทียบกับค่าโฆษณา ไม่ใช่อัตราคอมมิชชัน'),
    ],
  }));
  if (request.resource === 'detail')
    return {
      ...envelope,
      data: {
        content: clip,
        sourceUrl: null,
        eligibleSales: unmapped(clip.id)
          ? null
          : money(
              selected
                .filter((x) => x.kind === 'commission')
                .reduce((n, x) => n + BigInt(x.eligibleBase?.minor ?? '0'), 0n)
                .toString(),
            ),
        eligibleOrders: null,
        agreementVersion: selected[0]?.agreementVersion ?? null,
        earningsStatus: unmapped(clip.id)
          ? 'unavailable'
          : selected.some((x) => x.status === 'estimated')
            ? 'mixed'
            : 'confirmed',
        metrics: [
          metric('video_views', null, 'ยอดดูคลิปจากแพลตฟอร์ม เป็นข้อมูลประกอบ ไม่ใช่ยอดรายได้'),
          metric('reach', null, 'จำนวนผู้ชมไม่ซ้ำ ไม่สามารถรวมจากโฆษณาย่อยได้'),
        ],
        adCount: ads.length,
        attribution: unmapped(clip.id) ? 'partner-only' : 'content',
      },
    };
  if (request.resource === 'earnings')
    return {
      ...envelope,
      data: { ...paginate(selected), excludedCount: 0, unassignedAmount: money('0') },
    };
  if (request.resource === 'ads') return { ...envelope, data: paginate(ads) };
  const ad = ads.find((x) => x.id === request.adId);
  if (!ad) throw new ContentError('not_found', 'ไม่พบโฆษณานี้ หรือโฆษณาไม่ได้อยู่ในคลิปที่เลือก');
  return { ...envelope, data: ad };
}
export function createContentTransport(mode: ContentMode = 'ready'): ContentTransport {
  return async (request) => {
    await new Promise<void>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(
        () => {
          request.signal.removeEventListener('abort', abort);
          resolve();
        },
        mode === 'loading' ? 60000 : 120,
      );
      request.signal.addEventListener('abort', abort, { once: true });
    });
    if (mode === 'error') throw new Error('Synthetic content source unavailable');
    return contentFixture(request, mode);
  };
}
