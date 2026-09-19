// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ pitch: vi.fn(), auth: vi.fn(), read: vi.fn() }));
vi.mock('@/server/platform/pitch-mode', () => ({ pitchModeEnabled: mocks.pitch }));
vi.mock('@/server/platform/pitch-access', () => ({ authorizePitchRequest: mocks.auth }));
vi.mock('@/server/hosted-demo/daily-chart-fill/store', () => ({
  fillEnabled: () => process.env.LABSD_DEMO_DAILY_CHART_FILL_ENABLED === '1',
  readDailyFill: mocks.read,
  fillDirectory: () => process.env.LABSD_HOSTED_DATA_DIR,
}));
import { handleDailyFill } from '@/server/hosted-demo/daily-chart-fill/handler';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it('blocks native/off before authentication or storage', async () => {
  mocks.pitch.mockReturnValue(false);
  vi.stubEnv('LABSD_DEMO_DAILY_CHART_FILL_ENABLED', '1');
  expect(
    (await handleDailyFill(new Request('https://example.com/api/demo/daily-chart-fill'))).status,
  ).toBe(404);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  mocks.pitch.mockReturnValue(true);
  vi.stubEnv('LABSD_DEMO_DAILY_CHART_FILL_ENABLED', '0');
  expect(
    (await handleDailyFill(new Request('https://example.com/api/demo/daily-chart-fill'))).status,
  ).toBe(404);
});
it('requires pitch authorization before exposing data', async () => {
  mocks.pitch.mockReturnValue(true);
  vi.stubEnv('LABSD_DEMO_DAILY_CHART_FILL_ENABLED', '1');
  mocks.auth.mockResolvedValue(new Response(null, { status: 401 }));
  expect(
    (await handleDailyFill(new Request('https://example.com/api/demo/daily-chart-fill'))).status,
  ).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('returns private sample rows and filters future dates', async () => {
  mocks.pitch.mockReturnValue(true);
  vi.stubEnv('LABSD_DEMO_DAILY_CHART_FILL_ENABLED', '1');
  vi.stubEnv('LABSD_HOSTED_DATA_DIR', '/data');
  mocks.auth.mockResolvedValue(null);
  mocks.read.mockResolvedValue({
    version: 1,
    source: 'demo-daily-chart-fill',
    through: '2099-01-01',
    rows: [
      { date: '2026-09-19', brand: 'Axtion', minor: '100' },
      { date: '2099-01-01', brand: 'Axtion', minor: '200' },
    ],
  });
  const response = await handleDailyFill(
    new Request('https://example.com/api/demo/daily-chart-fill?identity=a'),
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await response.json()).rows).toHaveLength(1);
});
