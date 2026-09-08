import { Overview } from '@/contracts/overview';
import { EarningsResponse } from '@/contracts/earnings';
import {
  ContentListResponse,
  ContentDetailResponse,
  AdListResponse,
  AdDetailResponse,
} from '@/contracts/content';
import { Statement, StatementDetail, StatementList, Settlement } from '@/contracts/statements';
import { Session } from '@/contracts/session';
import { Account } from '@/contracts/account';
import { Notifications } from '@/contracts/notifications';
import { Changes } from '@/contracts/changes';
import { ImportList } from '@/contracts/operations';
export const money = (minor: string) => ({ currency: 'THB' as const, minor });
export const period = {
  from: '2026-07-01T00:00:00+07:00',
  toExclusive: '2026-09-01T00:00:00+07:00',
  timezone: 'Asia/Bangkok' as const,
};
export const at = '2026-09-01T12:00:00+07:00';
const freshness = {
  dataState: 'ready' as const,
  generatedAt: at,
  dataThrough: at,
  reasons: [],
  requestId: 'synthetic-foundation-request',
};
const amounts = ['1280000', '312000', '960000', '258000', '740000', '186000'];
const brands = ['Axtion', 'Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova'];
const titles = [
  'พูดตรง ๆ ตัวนี้ช่วยให้เช้าวันทำงานง่ายขึ้น',
  '3 นาทีหลังตื่นนอน กับ routine ที่ทำให้สดชื่น',
  'ลองให้ดูแบบไม่สปอนเซอร์ ถ้าไม่ดีก็ไม่พูด',
  'ของดีบอกต่อ เปิดกล่องแล้วชอบตรงไหน',
  'รีวิวแบบคนใช้จริง ดูผิวในแสงธรรมชาติ',
  'ตัวเดียวจบสำหรับวันที่ต้องออกกอง',
];
export function readyScenario() {
  const items = amounts.map((amount, i) => ({
    id: `clip-${i + 1}`,
    title: titles[i],
    brand: brands[i],
    publishedAt: `2026-08-${String(28 - i * 4).padStart(2, '0')}T12:00:00+07:00`,
    cover: `/media/clip-cover-${i + 1}.png`,
    coverPosition: '50% 50%',
    removed: false,
    views: 812000 - i * 75000,
    earned: money(amount),
    unavailableReason: null,
  }));
  const lines = items.map((item, i) => ({
    id: `earning-${i + 1}`,
    sourceRef: `synthetic-sale-${i + 1}`,
    sourceRevision: '1',
    agreementVersion: 'synthetic-agreement-1',
    earnedAt: item.publishedAt,
    contentId: item.id,
    kind: 'commission' as const,
    eligibleBase: money((BigInt(amounts[i]) * 10n).toString()),
    ratePpm: 100000,
    amount: money(amounts[i]),
    status: 'confirmed' as const,
    reason: null,
    evidenceRef: `synthetic-evidence-${i + 1}`,
    originalLineId: null,
    attribution: 'content' as const,
  }));
  const list = ContentListResponse.parse({
    ...freshness,
    generation: '1',
    period,
    data: { items, nextCursor: null, totalCount: 6 },
  });
  const overview = Overview.parse({
    ...freshness,
    earnings: {
      generation: '1',
      period,
      estimated: money('0'),
      confirmed: money('3736000'),
      eligibleSales: money('37360000'),
      unassignedAmount: money('0'),
      excludedCount: 0,
      trend: items.map((x) => ({ date: x.publishedAt.slice(0, 10), amount: x.earned })).reverse(),
      topContent: [items[0], items[2], items[4]],
    },
    obligation: {
      asOf: at,
      confirmedUnpaid: money('2552000'),
      nextPayout: {
        statementId: 'statement-1',
        period,
        scheduledAt: '2026-09-15T12:00:00+07:00',
        amount: money('2552000'),
      },
    },
  });
  const statement = Statement.parse({
    id: 'statement-1',
    version: '1',
    period,
    publishedAt: at,
    settlementAsOf: at,
    status: 'part-paid',
    opening: money('0'),
    newEarnings: money('3736000'),
    adjustments: money('0'),
    settled: money('1184000'),
    closing: money('2552000'),
  });
  const settlement = Settlement.parse({
    id: 'payment-1',
    reference: 'synthetic-transfer-1',
    recordedAt: at,
    cash: money('1184000'),
    withholding: money('0'),
    other: money('0'),
    obligationSettled: money('1184000'),
    evidenceRef: 'synthetic-payment-evidence',
  });
  const agreement = {
    id: 'synthetic-agreement-1',
    partnerId: 'partner-1',
    effective: period,
    calculationPeriod: 'statement',
    roundingRule: { mode: 'per-line', tieBreak: 'half-away-from-zero', allocation: 'none' },
    evidenceRef: 'synthetic-terms',
  };
  const metric = {
    key: 'impressions',
    value: 812000,
    unit: 'count',
    definition: 'จำนวนครั้งที่แสดงตามรายงานต้นทาง',
    source: 'synthetic-platform',
    period,
    dataThrough: at,
    unavailableReason: null,
    additive: true,
  };
  const ad = {
    id: 'ad-1',
    contentId: 'clip-1',
    title: 'คลิปสำหรับแคมเปญ',
    status: 'active',
    asOf: at,
    metrics: [metric],
  };
  return {
    name: 'ready',
    overview,
    content: list,
    earnings: EarningsResponse.parse({
      ...freshness,
      generation: '1',
      period,
      data: {
        items: lines,
        nextCursor: null,
        totalCount: 6,
        excludedCount: 0,
        unassignedAmount: money('0'),
      },
    }),
    contentDetail: ContentDetailResponse.parse({
      ...freshness,
      generation: '1',
      period,
      data: {
        content: items[0],
        sourceUrl: null,
        eligibleSales: lines[0].eligibleBase,
        eligibleOrders: null,
        agreementVersion: agreement.id,
        metrics: [metric],
        adCount: 1,
        attribution: 'content',
      },
    }),
    ads: AdListResponse.parse({
      ...freshness,
      generation: '1',
      period,
      data: { items: [ad], nextCursor: null, totalCount: 1 },
    }),
    ad: AdDetailResponse.parse({ ...freshness, generation: '1', period, data: ad }),
    statements: StatementList.parse({ items: [statement], nextCursor: null, totalCount: 1 }),
    statement: StatementDetail.parse({
      statement,
      lines: { items: lines, nextCursor: null, totalCount: 6 },
      settlements: { items: [settlement], nextCursor: null, totalCount: 1 },
      documents: [],
    }),
    session: Session.parse({
      userId: 'user-1',
      displayName: 'มดดำ คชาภา',
      activePartnerId: 'partner-1',
      memberships: [
        {
          partnerId: 'partner-1',
          partnerName: 'มดดำ คชาภา',
          permissionRevision: '1',
          capabilities: ['view_earnings', 'view_content', 'view_statements'],
        },
      ],
      access: 'active',
    }),
    account: Account.parse({
      userId: 'user-1',
      displayName: 'มดดำ คชาภา',
      agreement,
      providers: [{ provider: 'google', canUnlink: false }],
      supportUrl: null,
    }),
    notifications: Notifications.parse({
      items: [
        {
          id: 'notice-1',
          statementId: 'statement-1',
          title: 'สรุปคอมมิชชันพร้อมตรวจสอบ',
          kind: 'statement-published',
          createdAt: at,
          seen: false,
        },
      ],
      nextCursor: null,
      totalCount: 1,
      unseenCount: 1,
    }),
    changes: Changes.parse({
      partnerId: 'partner-1',
      permissionRevision: '1',
      earningsRevision: '1',
      settlementsRevision: '1',
      metricsRevision: '1',
      noticesRevision: '1',
      publishedAt: at,
      sources: [{ source: 'synthetic-platform', dataThrough: at, publishedAt: at }],
    }),
    imports: ImportList.parse({ items: [], nextCursor: null, totalCount: 0 }),
  };
}
export type Scenario = ReturnType<typeof readyScenario>;
