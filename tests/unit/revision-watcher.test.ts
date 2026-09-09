import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevisionWatcher, AccessLost } from '@/shared/query/revision-watcher';
import { partnerKey } from '@/shared/query/keys';
import { scenario } from '../../dev/scenarios';
const scope = { userId: 'user-1', partnerId: 'partner-1', permissionRevision: '1' };
const initial = () => scenario('ready').changes;
afterEach(() => vi.useRealTimers());
describe('active-page revision changes', () => {
  it('reconciles queries against the first native baseline once, then invalidates only changed groups', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const load = vi.fn().mockResolvedValue(initial());
    const w = new RevisionWatcher({
      scope,
      reconcileInitial: true,
      load,
      onChange,
      onAccessLost: vi.fn(),
      random: () => 0,
    });
    w.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange.mock.calls[0][0]).toEqual(['earnings', 'settlements', 'metrics', 'notices']);
    await vi.advanceTimersByTimeAsync(30000);
    expect(onChange).toHaveBeenCalledTimes(1);
    load.mockResolvedValue({ ...initial(), noticesRevision: '2', metricsRevision: '2' });
    await vi.advanceTimersByTimeAsync(30000);
    expect(onChange.mock.calls[1][0]).toEqual(['metrics', 'notices']);
    w.stop();
  });
  it('catches publication between scoped bootstrap and the first page read', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const w = new RevisionWatcher({
      scope,
      initial: initial(),
      load: async () => ({ ...initial(), earningsRevision: '2' }),
      onChange,
      onAccessLost: vi.fn(),
    });
    w.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange.mock.calls[0][0]).toEqual(['earnings']);
    w.stop();
    expect(
      () =>
        new RevisionWatcher({
          scope,
          initial: { ...initial(), partnerId: 'other' },
          load: vi.fn(),
          onChange,
          onAccessLost: vi.fn(),
        }),
    ).toThrow(AccessLost);
  });
  it('polls only changed data groups and ignores older revisions', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const load = vi
      .fn()
      .mockResolvedValueOnce(initial())
      .mockResolvedValueOnce({ ...initial(), earningsRevision: '2' })
      .mockResolvedValueOnce({ ...initial(), settlementsRevision: '2' });
    const w = new RevisionWatcher({
      scope,
      load,
      onChange,
      onAccessLost: vi.fn(),
      random: () => 0,
    });
    w.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    expect(onChange.mock.calls[0][0]).toEqual(['earnings']);
    await vi.advanceTimersByTimeAsync(30000);
    expect(onChange.mock.calls[1][0]).toEqual(['settlements']);
    expect(onChange.mock.calls[1][1].earningsRevision).toBe('2');
    w.stop();
  });
  it('pauses, aborts, ignores an obsolete response, and checks immediately on resume', async () => {
    vi.useFakeTimers();
    let resolveOld!: (v: unknown) => void;
    let oldSignal!: AbortSignal;
    const load = vi
      .fn()
      .mockImplementationOnce((signal) => {
        oldSignal = signal;
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      })
      .mockResolvedValue(initial());
    const onChange = vi.fn();
    const w = new RevisionWatcher({
      scope,
      load,
      onChange,
      onAccessLost: vi.fn(),
      random: () => 0,
    });
    w.setActive(true);
    void w.check();
    expect(load).toHaveBeenCalledTimes(1);
    w.setActive(false);
    expect(oldSignal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(100000);
    expect(load).toHaveBeenCalledTimes(1);
    w.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    resolveOld({ ...initial(), earningsRevision: '99' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    w.stop();
  });
  it('backs off transport failures but stops when access is lost', async () => {
    vi.useFakeTimers();
    const denied = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new AccessLost());
    const w = new RevisionWatcher({
      scope,
      load,
      onChange: vi.fn(),
      onAccessLost: denied,
      random: () => 0,
    });
    w.setActive(true);
    await vi.advanceTimersByTimeAsync(59000);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(denied).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(900000);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('rejects a response for another membership', async () => {
    vi.useFakeTimers();
    const denied = vi.fn();
    const w = new RevisionWatcher({
      scope,
      load: async () => ({ ...initial(), partnerId: 'other' }),
      onChange: vi.fn(),
      onAccessLost: denied,
    });
    w.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(denied).toHaveBeenCalledOnce();
    w.stop();
  });
  it('normalizes filters but separates identities, permissions and generations', () => {
    expect(
      partnerKey(scope, 'earnings', 'overview', { brand: null, from: '2026-08-01' }, '1'),
    ).toEqual(partnerKey(scope, 'earnings', 'overview', { from: '2026-08-01', brand: null }, '1'));
    expect(partnerKey(scope, 'earnings', 'overview')).not.toEqual(
      partnerKey({ ...scope, userId: 'other' }, 'earnings', 'overview'),
    );
  });
});
