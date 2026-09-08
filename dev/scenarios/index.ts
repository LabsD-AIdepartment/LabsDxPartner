import { readyScenario, money, type Scenario } from './ready';
export { readyScenario, type Scenario } from './ready';
export const scenarioNames = [
  'ready',
  'empty',
  'partial',
  'stale',
  'unavailable',
  'adjustments',
  'access',
] as const;
export type ScenarioName = (typeof scenarioNames)[number];
export function scenario(name: ScenarioName): Scenario {
  const s = readyScenario();
  s.name = name;
  if (name === 'empty') {
    s.overview.earnings = {
      ...s.overview.earnings,
      confirmed: money('0'),
      eligibleSales: money('0'),
      topContent: [],
      trend: [],
    };
    s.overview.obligation = {
      ...s.overview.obligation,
      confirmedUnpaid: money('0'),
      nextPayout: null,
    };
    s.content.data = { items: [], nextCursor: null, totalCount: 0 };
    s.earnings.data = { ...s.earnings.data, items: [], totalCount: 0 };
    s.statements = { items: [], nextCursor: null, totalCount: 0 };
    s.notifications = { items: [], nextCursor: null, totalCount: 0, unseenCount: 0 };
  }
  if (name === 'partial') {
    s.overview.dataState = 'partial';
    s.overview.reasons = ['บางรายการยังจับคู่กับคลิปไม่ได้'];
    s.earnings.data.items[0] = {
      ...s.earnings.data.items[0],
      contentId: null,
      attribution: 'partner-only',
    };
    s.earnings.data.unassignedAmount = money('1280000');
    s.earnings.dataState = 'partial';
    s.overview.earnings.unassignedAmount = money('1280000');
    s.overview.earnings.topContent = s.overview.earnings.topContent.filter(
      (x) => x.id !== 'clip-1',
    );
    s.content.data.items[0] = {
      ...s.content.data.items[0],
      earned: null,
      unavailableReason: 'ยังไม่มีหลักฐานจับคู่รายได้กับคลิป',
    };
  }
  if (name === 'stale' || name === 'unavailable')
    for (const row of [s.overview, s.content, s.earnings, s.contentDetail, s.ads, s.ad]) {
      row.dataState = name;
      row.dataThrough = name === 'stale' ? '2026-08-29T12:00:00+07:00' : null;
      row.reasons = [name === 'stale' ? 'รอข้อมูลรอบใหม่จากต้นทาง' : 'ต้นทางยังไม่พร้อมให้ข้อมูล'];
    }
  if (name === 'adjustments') {
    const line = {
      ...s.earnings.data.items[0],
      id: 'correction-1',
      kind: 'adjustment' as const,
      status: 'adjustment' as const,
      amount: money('-200000'),
      originalLineId: 'earning-1',
      reason: 'ปรับจากรายการคืนสินค้า',
    };
    s.earnings.data.items.push(line);
    s.earnings.data.totalCount = 7;
    s.overview.earnings.confirmed = money('3536000');
    s.overview.earnings.trend[5].amount = money('1080000');
    s.content.data.items[0].earned = money('1080000');
    s.overview.earnings.topContent[0].earned = money('1080000');
    // Issued statement remains unchanged; correction is not yet published to a new statement.
  }
  if (name === 'access') {
    s.session.access = 'suspended';
    s.session.activePartnerId = null;
  }
  return s;
}
