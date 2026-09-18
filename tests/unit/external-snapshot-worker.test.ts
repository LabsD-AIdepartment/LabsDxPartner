import { describe, expect, it, vi } from 'vitest';
import { runSnapshotWorkerCycle } from '@/server/modules/marketing-ads/facebook/snapshot-worker';
import {
  snapshotBindingKey,
  type createSnapshotDatabase,
} from '@/server/modules/marketing-ads/facebook/snapshot-database';
import { AdSnapshotBindingConfig } from '@/server/modules/marketing-ads/facebook/snapshot-config';
import type { buildAdSnapshot } from '@/server/modules/marketing-ads/facebook/snapshot-refresh';

const binding = AdSnapshotBindingConfig.parse({
  identity: 'a',
  clipId: 'clip-3',
  profileId: 'fixture',
  namespace: 'test',
  accountId: '1',
  adId: '2',
  expectedCreativeId: '3',
  expectedVideoId: null,
  currency: 'THB',
  timezone: 'Asia/Bangkok',
  from: '2026-07-01',
  toExclusive: '2026-09-01',
  canViewSpend: false,
});
const env = {
  LABSD_AD_SNAPSHOT_ENABLED: '1',
  LABSD_AD_SNAPSHOT_BINDINGS: JSON.stringify([binding]),
};
const lease = {
  bindingKey: snapshotBindingKey(binding),
  from: binding.from,
  toExclusive: binding.toExclusive,
  token: 'test-lease',
};
function fixture() {
  const store = {
    request: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(),
    seed: vi.fn(),
    claim: vi.fn().mockResolvedValue(null),
    publish: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(undefined),
  } satisfies ReturnType<typeof createSnapshotDatabase>;
  const assertBinding = vi.fn().mockResolvedValue(undefined);
  return {
    store,
    assertBinding,
    env,
    signal: new AbortController().signal,
    now: () => Date.parse('2026-09-18T10:00:00+07:00'),
  };
}
describe('hourly external snapshot worker cycle', () => {
  it('registers configured and current windows without acquiring when nothing is due', async () => {
    const f = fixture(),
      acquire = vi.fn<typeof buildAdSnapshot>();
    await runSnapshotWorkerCycle({ ...f, acquire });
    expect(f.store.request.mock.calls.map(([b]) => [b.from, b.toExclusive])).toEqual([
      ['2026-07-01', '2026-09-01'],
      ['2026-09-01', '2026-09-19'],
      ['2026-09-12', '2026-09-19'],
    ]);
    expect(acquire).not.toHaveBeenCalled();
  });
  it('preserves last-good on source failure and rechecks namespace before publication', async () => {
    const f = fixture();
    f.store.claim.mockResolvedValueOnce(lease);
    const acquire = vi.fn<typeof buildAdSnapshot>().mockRejectedValue(new Error('source failure'));
    expect(await runSnapshotWorkerCycle({ ...f, acquire })).toEqual({
      attempted: 1,
      published: 0,
      failed: 1,
    });
    expect(f.store.fail).toHaveBeenCalledWith(lease);
    expect(f.store.publish).not.toHaveBeenCalled();
    expect(acquire.mock.calls[0][0]).toEqual(binding);
    expect(acquire.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    const blocked = fixture();
    blocked.assertBinding.mockRejectedValue(new Error('namespace changed'));
    await expect(runSnapshotWorkerCycle({ ...blocked, acquire })).rejects.toThrow(
      'namespace changed',
    );
    expect(blocked.store.request).not.toHaveBeenCalled();
  });
});
