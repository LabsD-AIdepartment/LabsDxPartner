import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CapabilityAvailability,
  ResolvedSourceV2,
  SourceIdentityV2,
  sourceIdentityKey,
} from '@/contracts/platform-capabilities';
import {
  PlatformMetricV2,
  SourceReportV2,
  decimalToMinor,
  formatExactDecimal,
  formatExactPercentage,
  type PlatformMetricValue,
} from '@/contracts/platform-metrics';
import {
  createMarketingProviderRegistry,
  type MarketingReadAdapter,
} from '@/server/modules/marketing-ads/provider';
import { AdRegistrationSnapshot, registrationIssue } from '@/contracts/ad-registration';
import { createAdRegistrationTransport, marketingScope } from '../../dev/ad-registration-transport';
import {
  readRegistration,
  resolveRegistration,
  saveRegistration,
} from '@/features/marketing-ads/model';
import { AdRegistrationConsole } from '@/features/marketing-ads/AdRegistrationConsole';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { PlatformMetricDefinition } from '@/features/content/MetricDefinition';

const signal = () => new AbortController().signal;
const identity = SourceIdentityV2.parse({
  schemaVersion: 2,
  platform: 'facebook',
  capability: 'facebook.ad_insights',
  namespace: 'meta',
  connectionId: 'connection-1',
  accountId: 'act_1',
  objectType: 'ad',
  externalId: '000900719925474099312345',
});
const metric: PlatformMetricValue = {
  schemaVersion: 2,
  key: 'platform_value',
  value: '9007199254740993.01',
  unit: 'money',
  currency: 'THB',
  definition: 'Platform-attributed value, not commission',
  unavailableReason: null,
  aggregation: 'sum-disjoint',
};
const period = {
  from: '2026-07-01T00:00:00+07:00',
  toExclusive: '2026-08-01T00:00:00+07:00',
  timezone: 'Asia/Bangkok',
};
const report = () => ({
  schemaVersion: 2 as const,
  identity: { ...identity },
  grain: 'ad-period' as const,
  apiVersion: 'v25.0',
  reportDefinition: 'ad-total-v1',
  attribution: '7d_click',
  actionReportTime: 'conversion',
  period: { ...period },
  coveredPeriod: { ...period },
  fetchedAt: '2026-08-02T00:00:00Z',
  dataThrough: null,
  completeness: 'complete' as const,
  nextCursor: null,
  reason: null,
  metrics: [{ ...metric }],
});
const resolved = () => ({
  schemaVersion: 2,
  identity: { ...identity },
  apiVersion: 'v25.0',
  sourceRevision: null,
  name: 'Ad',
  creativeIds: ['creative-1', 'creative-2'],
  fetchedAt: '2026-08-02T00:00:00Z',
});
const adapter = (): MarketingReadAdapter => ({
  capability: 'facebook.ad_insights',
  resolve: vi.fn(async () => resolved()),
  report: vi.fn(async () => report()),
});
describe('versioned native source identity and adapter boundary', () => {
  it('does not let an adapter mutate the expected identity or period to evade validation', async () => {
    const a = adapter();
    a.resolve = async (request) => {
      request.accountId = 'foreign';
      return { ...resolved(), identity: request };
    };
    const registry = createMarketingProviderRegistry([a]);
    await expect(registry.resolve(identity, signal())).rejects.toThrow('different source');
    a.report = async (request, requestedPeriod) => {
      requestedPeriod.from = '2026-06-01T00:00:00+07:00';
      return {
        ...report(),
        identity: request,
        period: requestedPeriod,
        coveredPeriod: requestedPeriod,
      };
    };
    await expect(registry.report(identity, period, signal())).rejects.toThrow(
      'different reporting period',
    );
    expect(identity.accountId).toBe('act_1');
    expect(period.from).toBe('2026-07-01T00:00:00+07:00');
  });
  it('retains opaque IDs, rejects wrong grain/version and separates source accounts', () => {
    expect(identity.externalId).toBe('000900719925474099312345');
    for (const patch of [
      { externalId: 123 },
      { objectType: 'campaign' },
      { platform: 'shopee' },
      { schemaVersion: 1 },
      { externalId: ' 123' },
    ])
      expect(SourceIdentityV2.safeParse({ ...identity, ...patch }).success).toBe(false);
    expect(sourceIdentityKey(identity)).not.toEqual(
      sourceIdentityKey({ ...identity, accountId: 'act_2' }),
    );
    expect(sourceIdentityKey(identity)).toEqual(
      sourceIdentityKey({ ...identity, connectionId: 'replacement' }),
    );
  });
  it('preserves unknown or multiple creatives without inventing a single-clip mapping', () => {
    expect(ResolvedSourceV2.parse(resolved()).creativeIds).toHaveLength(2);
    expect(ResolvedSourceV2.parse({ ...resolved(), creativeIds: null }).creativeIds).toBeNull();
    expect(ResolvedSourceV2.safeParse({ ...resolved(), creativeIds: ['x', 'x'] }).success).toBe(
      false,
    );
  });
  it('has no installed native adapter by default and rejects duplicate provider ownership', async () => {
    await expect(createMarketingProviderRegistry().resolve(identity, signal())).rejects.toThrow(
      'not installed',
    );
    expect(() => createMarketingProviderRegistry([adapter(), adapter()])).toThrow('Duplicate');
  });
  it('validates both object and report responses against requested identity', async () => {
    const a = adapter();
    const registry = createMarketingProviderRegistry([a]);
    expect((await registry.resolve(identity, signal())).creativeIds).toHaveLength(2);
    expect((await registry.report(identity, period, signal())).metrics[0].value).toBe(metric.value);
    a.resolve = async () => ({ ...resolved(), identity: { ...identity, accountId: 'other' } });
    await expect(registry.resolve(identity, signal())).rejects.toThrow('different source');
    a.report = async () => ({ ...report(), identity: { ...identity, connectionId: 'other' } });
    await expect(registry.report(identity, period, signal())).rejects.toThrow('different source');
  });
  it('rejects wrong reporting windows and late results after abort', async () => {
    const a = adapter();
    a.report = async () => ({
      ...report(),
      period: { ...period, from: '2026-06-01T00:00:00+07:00' },
      completeness: 'partial',
      reason: 'Only July',
    });
    const registry = createMarketingProviderRegistry([a]);
    await expect(registry.report(identity, period, signal())).rejects.toThrow(
      'different reporting period',
    );
    const controller = new AbortController();
    a.resolve = async () => {
      controller.abort();
      return resolved();
    };
    await expect(registry.resolve(identity, controller.signal)).rejects.toThrow();
  });
});
describe('exact platform metrics and coverage', () => {
  it.each([
    ['0', '0.00%'],
    ['1', '100.00%'],
    ['0.045', '4.50%'],
    ['0.00005', '0.01%'],
    ['0.99995', '100.00%'],
    ['0.999949999999999999', '99.99%'],
  ])('formats exact source fraction %s as %s', (raw, display) => {
    expect(formatExactPercentage(raw)).toBe(display);
  });
  it('round-trips decimals beyond safe Number range without any numeric conversion', () => {
    expect(PlatformMetricV2.parse(JSON.parse(JSON.stringify(metric))).value).toBe(
      '9007199254740993.01',
    );
    expect(decimalToMinor(metric.value!, 2)).toBe('900719925474099301');
    expect(decimalToMinor('0.10', 2)).toBe('10');
    expect(decimalToMinor('1.2300', 2)).toBe('123');
    expect(() => decimalToMinor('1.231', 2)).toThrow('precision');
    expect(formatExactDecimal('999.995', 2)).toBe('1,000.00');
  });
  it.each([1.23, '1e3', 'NaN', '-1', ' 1', '01', '1.', '0.1234567890123456789'])(
    'rejects ambiguous decimal wire value %s',
    (value) => {
      expect(PlatformMetricV2.safeParse({ ...metric, value }).success).toBe(false);
    },
  );
  it('keeps missing and zero distinct and enforces units, currencies and additivity', () => {
    expect(PlatformMetricV2.parse({ ...metric, value: '0' }).value).toBe('0');
    expect(
      PlatformMetricV2.parse({ ...metric, value: null, unavailableReason: 'Not reported' }).value,
    ).toBeNull();
    for (const patch of [
      { value: null },
      { value: '0', unavailableReason: 'Missing' },
      { unit: 'count' },
      { currency: null },
      { key: 'reach', unit: 'count', currency: null, value: '1', aggregation: 'sum-disjoint' },
      { key: 'roas', unit: 'ratio', currency: null, aggregation: 'sum-disjoint' },
      { key: 'impressions', unit: 'count', currency: null, value: '1.1' },
    ])
      expect(PlatformMetricV2.safeParse({ ...metric, ...patch }).success).toBe(false);
    expect(
      PlatformMetricV2.parse({
        ...metric,
        key: 'impressions',
        unit: 'count',
        currency: null,
        value: '90071992547409931234',
      }).value,
    ).toBe('90071992547409931234');
  });
  it('refuses complete labels on unfinished, missing, mixed or mismatched observations', () => {
    expect(SourceReportV2.safeParse(report()).success).toBe(true);
    for (const patch of [
      { nextCursor: 'next-page' },
      { coveredPeriod: null },
      { grain: 'campaign' },
      { metrics: [metric, metric] },
      { coveredPeriod: { ...period, from: '2026-07-02T00:00:00+07:00' } },
      { dataThrough: '2026-08-03T00:00:00Z' },
      { metrics: [metric, { ...metric, key: 'spend', currency: 'USD' }] },
    ])
      expect(SourceReportV2.safeParse({ ...report(), ...patch }).success).toBe(false);
    expect(
      SourceReportV2.safeParse({
        ...report(),
        completeness: 'partial',
        reason: 'Next page failed',
        nextCursor: 'cursor',
      }).success,
    ).toBe(true);
    expect(
      SourceReportV2.safeParse({
        ...report(),
        completeness: 'unavailable',
        reason: 'Denied',
        coveredPeriod: null,
        metrics: [],
      }).success,
    ).toBe(true);
  });
  it('uses the shared card for exact display, without changing the legacy metric DTO', () => {
    render(<PlatformMetricDefinition metric={metric} report={report()} />);
    expect(screen.getByText('฿9,007,199,254,740,993.01')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'มูลค่าตามแพลตฟอร์ม' })).toBeVisible();
    expect(screen.queryByText('Platform-attributed value, not commission')).not.toBeInTheDocument();
  });
});
const draft = {
  targetId: 'target-clip-1',
  platform: 'facebook' as const,
  connectionId: 'fb-main',
  externalId: '000123456789',
};
describe('per-connection capability lifecycle', () => {
  it('requires verified enabled configurations and rejects capability/platform mismatches', async () => {
    expect(
      CapabilityAvailability.safeParse({
        capability: 'facebook.ad_insights',
        phase: 'enabled',
        verifiedAt: null,
        reason: null,
      }).success,
    ).toBe(false);
    const dev = createAdRegistrationTransport({ latency: 0 });
    const value = await readRegistration(dev.transport, marketingScope, signal());
    const wrong = structuredClone(value);
    wrong.connections[0].availability.capability = 'shopee.ads_reporting';
    expect(AdRegistrationSnapshot.safeParse(wrong).success).toBe(false);
    expect(AdRegistrationSnapshot.safeParse({ ...value, schemaVersion: 1 }).success).toBe(false);
    const shop = value.connections.find((row) => row.platform === 'shopee')!;
    expect(registrationIssue(shop, 'native')).toMatch(/ยังไม่ยืนยัน/);
    expect(registrationIssue(shop, 'synthetic')).toBeNull();
  });
  it('denies a disabled connection even when the client retains an enabled snapshot; preserves history and other accounts', async () => {
    const dev = createAdRegistrationTransport({ latency: 0 });
    const value = await readRegistration(dev.transport, marketingScope, signal());
    const first = await resolveRegistration(dev.transport, marketingScope, value, draft, signal());
    await saveRegistration(dev.transport, marketingScope, value, first, draft, signal());
    const pending = await resolveRegistration(
      dev.transport,
      marketingScope,
      value,
      { ...draft, externalId: 'another' },
      signal(),
    );
    dev.setCapabilityPhase('fb-main', 'disabled');
    await expect(
      saveRegistration(dev.transport, marketingScope, value, pending, pending.draft, signal()),
    ).rejects.toMatchObject({ code: 'unsupported' });
    const refreshed = await readRegistration(dev.transport, marketingScope, signal());
    expect(refreshed.associations).toHaveLength(1);
    await expect(
      resolveRegistration(dev.transport, marketingScope, refreshed, draft, signal()),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(
      await resolveRegistration(
        dev.transport,
        marketingScope,
        refreshed,
        { ...draft, connectionId: 'fb-second' },
        signal(),
      ),
    ).toBeTruthy();
  });
  it('renders only server-provided platform choices and explains an unavailable account', async () => {
    const dev = createAdRegistrationTransport({ latency: 0 });
    const value = await readRegistration(dev.transport, marketingScope, signal());
    value.connections = value.connections.filter((row) => row.id === 'fb-main');
    value.connections[0].availability = {
      ...value.connections[0].availability,
      phase: 'configured',
      verifiedAt: null,
      reason: 'กำลังเตรียมบัญชีนี้',
    };
    value.sourceMode = 'native';
    render(
      <IsolatedQueryProvider identity={['capability-ui']}>
        <AdRegistrationConsole
          scope={marketingScope}
          transport={{ ...dev.transport, read: async () => value }}
        />
      </IsolatedQueryProvider>,
    );
    const select = await screen.findByLabelText('แพลตฟอร์ม');
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      'facebook',
    ]);
    fireEvent.change(screen.getByLabelText('Ad ID'), { target: { value: '123' } });
    expect(screen.getByRole('button', { name: 'ค้นหาแอด' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('กำลังเตรียมบัญชีนี้');
  });
});
