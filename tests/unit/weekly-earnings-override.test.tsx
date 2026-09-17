import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { OverviewPage } from '@/features/overview/OverviewPage';
import type { OverviewTransport } from '@/features/overview/model';
import { createQueryClient } from '@/shared/query/provider';
import { overviewFixture } from '../../dev/overview-transport';
import { createWeeklyEarningsSampleTransport } from '../../dev/weekly-earnings-sample';

const scope = { userId: 'ov-user', partnerId: 'ov-partner', permissionRevision: '1' };
let plotWidth = 300;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T12:00:00Z'));
  plotWidth = 300;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: plotWidth } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>
);
const chartDates = (host: HTMLElement) =>
  [...host.querySelectorAll('text[data-date]')].map((el) => el.getAttribute('data-date'));
// Every earnings generation currently cached in a client, so a test can prove each query kept its
// own value (the fixture generation vs the explicit 'weekly-sample-v1') in the same QueryClient.
const cacheGenerations = (client: ReturnType<typeof createQueryClient>) =>
  client
    .getQueryCache()
    .getAll()
    .map(
      (query) =>
        (query.state.data as { earnings?: { generation?: string } } | undefined)?.earnings
          ?.generation,
    )
    .filter((generation): generation is string => Boolean(generation));

describe('weekly earnings override wiring', () => {
  it('renders the labelled sample in the weekly card while the general Overview query stays isolated', async () => {
    const main = vi.fn<OverviewTransport>(async ({ filters }) => overviewFixture(filters));
    const inner = createWeeklyEarningsSampleTransport();
    const sample = vi.fn<OverviewTransport>((request) => inner(request));
    const view = render(
      wrap(
        <OverviewPage
          scope={scope}
          transport={main}
          brands={[]}
          weeklyEarningsOverride={{
            transport: sample,
            cacheKey: 'partner-demo/mddam',
            notice: 'ตัวอย่างคอมมิชชันรายวัน',
          }}
        />,
      ),
    );
    // The page headline still comes from the general transport (real selected range).
    await screen.findAllByText('฿37,360');
    const card = screen.getByRole('heading', { name: 'Daily Clip Earnings' }).closest('article')!;
    // Sample data is clearly labelled in the weekly card.
    expect(within(card).getByText(/ข้อมูลตัวอย่าง/)).toBeVisible();
    // The weekly card renders the seven-day sample anchored to Bangkok today.
    await within(card).findByText(/2026-09-16/);
    expect(chartDates(view.container)).toHaveLength(7);

    // Isolation: the general query used ONLY the page transport for the selected range; the sample
    // transport served ONLY the weekly window. Neither crossed into the other's cache identity.
    const mainFilters = main.mock.calls.map(([r]) => r.filters);
    const sampleFilters = sample.mock.calls.map(([r]) => r.filters);
    const selectedRange = { from: '2026-07-01', toExclusive: '2026-09-01', brand: null };
    const weeklyWindow = { from: '2026-09-10', toExclusive: '2026-09-17', brand: null };
    expect(mainFilters).toContainEqual(selectedRange);
    expect(mainFilters).not.toContainEqual(weeklyWindow);
    expect(sampleFilters).toContainEqual(weeklyWindow);
    expect(sampleFilters).not.toContainEqual(selectedRange);
  });

  it('leaves the weekly card on the general transport with no sample label when no override is given', async () => {
    const main = vi.fn<OverviewTransport>(async ({ filters }) => overviewFixture(filters));
    render(wrap(<OverviewPage scope={scope} transport={main} brands={[]} />));
    await screen.findAllByText('฿37,360');
    expect(screen.queryByText(/ข้อมูลตัวอย่าง/)).toBeNull();
    // The weekly card mounts after `useBangkokToday` resolves and issues its OWN request; wait for
    // that weekly-window call before asserting the transport call list to avoid a race.
    await waitFor(() =>
      expect(main.mock.calls.map(([r]) => r.filters)).toContainEqual({
        from: '2026-09-10',
        toExclusive: '2026-09-17',
        brand: null,
      }),
    );
    // Both the general range and the weekly window were served by the single page transport.
    expect(main.mock.calls.map(([r]) => r.filters)).toContainEqual({
      from: '2026-07-01',
      toExclusive: '2026-09-01',
      brand: null,
    });
  });

  it('keeps the sample and general query independent when the main filters exactly match the sample week', async () => {
    // Main range EXACTLY equals the latest-7 sample window, same scope and (null) brand. Without the
    // override cache suffix the two queries would share a key and collide/dedup; the suffix keeps them
    // apart so each is fetched and cached independently.
    const weeklyWindow = { from: '2026-09-10', toExclusive: '2026-09-17', brand: null };
    const main = vi.fn<OverviewTransport>(async ({ filters }) => overviewFixture(filters));
    const inner = createWeeklyEarningsSampleTransport(new Date('2026-09-16T12:00:00Z'));
    const sample = vi.fn<OverviewTransport>((request) => inner(request));
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <OverviewPage
          scope={scope}
          transport={main}
          brands={[]}
          initialFilters={weeklyWindow}
          weeklyEarningsOverride={{
            transport: sample,
            cacheKey: 'partner-demo/mddam',
            notice: 'ตัวอย่าง',
          }}
        />
      </QueryClientProvider>,
    );
    // The initial Bangkok-day loading header may be replaced before the week mounts.
    // Wait for the ready weekly content, then scope assertions to its current card.
    await screen.findByText(/ข้อมูลตัวอย่าง/);
    const card = screen.getByRole('heading', { name: 'Daily Clip Earnings' }).closest('article')!;
    expect(await within(card).findByText(/ข้อมูลตัวอย่าง/)).toBeVisible();
    // Both transports actually ran for the identical window — proof the keys did not collide/dedup.
    await waitFor(() => {
      expect(main.mock.calls.map(([r]) => r.filters)).toContainEqual(weeklyWindow);
      expect(sample.mock.calls.map(([r]) => r.filters)).toContainEqual(weeklyWindow);
    });
    // Each query retains its OWN value in the shared client: the general query keeps the fixture
    // generation while the weekly card keeps the explicit sample generation.
    await waitFor(() => {
      expect(cacheGenerations(client)).toContain('weekly-sample-v1');
      expect(cacheGenerations(client).some((g) => g !== 'weekly-sample-v1')).toBe(true);
      const earnings = client
        .getQueryCache()
        .getAll()
        .flatMap((query) => {
          const data = query.state.data as
            { earnings?: { generation: string; confirmed: { minor: string } } } | undefined;
          return data?.earnings ? [data.earnings] : [];
        });
      expect(
        earnings.find((value) => value.generation === 'weekly-sample-v1')?.confirmed.minor,
      ).toBe('1492500');
      expect(
        earnings.find((value) => value.generation !== 'weekly-sample-v1')?.confirmed.minor,
      ).toBe('0');
    });
  });

  it('does not leak the sample into the general query when the override is switched off for the same week', async () => {
    const weeklyWindow = { from: '2026-09-10', toExclusive: '2026-09-17', brand: null };
    const main = vi.fn<OverviewTransport>(async ({ filters }) => overviewFixture(filters));
    const sample = createWeeklyEarningsSampleTransport(new Date('2026-09-16T12:00:00Z'));
    const client = createQueryClient();
    const page = (enabled: boolean) => (
      <QueryClientProvider client={client}>
        <OverviewPage
          scope={scope}
          transport={main}
          brands={[]}
          initialFilters={weeklyWindow}
          weeklyEarningsOverride={
            enabled
              ? { transport: sample, cacheKey: 'partner-demo/mddam', notice: 'ตัวอย่าง' }
              : undefined
          }
        />
      </QueryClientProvider>
    );
    const view = render(page(true));
    // The initial Bangkok-day loading header may be replaced before the week mounts.
    // Wait for the ready weekly content, then scope assertions to its current card.
    await screen.findByText(/ข้อมูลตัวอย่าง/);
    const card = screen.getByRole('heading', { name: 'Daily Clip Earnings' }).closest('article')!;
    await within(card).findByText(/2026-09-\d{2}: ฿4,156\.00/);
    expect(within(card).getByText(/ข้อมูลตัวอย่าง/)).toBeVisible();
    expect(cacheGenerations(client)).toContain('weekly-sample-v1');

    // Switch the mounted page in the SAME QueryClient, leaving the sample cache intact.
    view.rerender(page(false));
    await waitFor(() => {
      expect(within(card).queryByText(/ข้อมูลตัวอย่าง/)).toBeNull();
      const titles = [...card.querySelectorAll('circle title')].map((title) => title.textContent);
      expect(titles).toHaveLength(7);
      expect(titles.every((title) => title?.endsWith(': ฿0.00'))).toBe(true);
      expect(main.mock.calls.map(([request]) => request.filters)).toContainEqual(weeklyWindow);
    });
    expect(chartDates(view.container)).toHaveLength(7);
    expect(cacheGenerations(client)).toContain('weekly-sample-v1');
    expect(cacheGenerations(client).some((generation) => generation !== 'weekly-sample-v1')).toBe(
      true,
    );
  });
});
