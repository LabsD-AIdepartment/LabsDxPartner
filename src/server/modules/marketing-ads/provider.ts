import { z } from 'zod';
import {
  SourceIdentityV2,
  ResolvedSourceV2,
  sourceIdentityKey,
  type Capability,
} from '@/contracts/platform-capabilities';
import { SourcePeriod, SourceReportV2 } from '@/contracts/platform-metrics';

export type ResolvePurpose = 'registration' | 'history';
export interface MarketingReadAdapter {
  capability: Capability;
  supportsConnection?: (connectionId: string) => boolean;
  resolve(
    identity: z.infer<typeof SourceIdentityV2>,
    signal: AbortSignal,
    purpose?: ResolvePurpose,
  ): Promise<unknown>;
  report(
    identity: z.infer<typeof SourceIdentityV2>,
    period: z.infer<typeof SourcePeriod>,
    signal: AbortSignal,
  ): Promise<unknown>;
}
/** No native providers are installed in P00. A browser capability flag cannot install one. */
export function createMarketingProviderRegistry(adapters: readonly MarketingReadAdapter[] = []) {
  const registry = new Map<Capability, MarketingReadAdapter>();
  for (const adapter of adapters) {
    if (registry.has(adapter.capability)) throw new Error('Duplicate capability adapter');
    registry.set(adapter.capability, adapter);
  }
  const checked = (raw: z.infer<typeof SourceIdentityV2>, signal: AbortSignal) => {
    signal.throwIfAborted();
    const identity = SourceIdentityV2.parse(raw);
    const adapter = registry.get(identity.capability);
    if (!adapter) throw new Error('Native capability is not installed');
    return { identity, adapter };
  };
  const assertIdentity = (
    a: z.infer<typeof SourceIdentityV2>,
    b: z.infer<typeof SourceIdentityV2>,
  ) => {
    if (
      sourceIdentityKey(a) !== sourceIdentityKey(b) ||
      a.connectionId !== b.connectionId ||
      a.capability !== b.capability
    )
      throw new Error('Provider returned a different source identity');
  };
  return {
    supports(capability: Capability, connectionId?: string) {
      const adapter = registry.get(capability);
      return (
        !!adapter &&
        (connectionId === undefined ||
          !adapter.supportsConnection ||
          adapter.supportsConnection(connectionId))
      );
    },
    async resolve(
      raw: z.infer<typeof SourceIdentityV2>,
      signal: AbortSignal,
      purpose: ResolvePurpose = 'registration',
    ) {
      const { identity, adapter } = checked(raw, signal);
      const result = ResolvedSourceV2.parse(
        await adapter.resolve(structuredClone(identity), signal, purpose),
      );
      signal.throwIfAborted();
      assertIdentity(identity, result.identity);
      return result;
    },
    async report(
      raw: z.infer<typeof SourceIdentityV2>,
      rawPeriod: z.infer<typeof SourcePeriod>,
      signal: AbortSignal,
    ) {
      const { identity, adapter } = checked(raw, signal);
      const period = SourcePeriod.parse(rawPeriod);
      const result = SourceReportV2.parse(
        await adapter.report(structuredClone(identity), structuredClone(period), signal),
      );
      signal.throwIfAborted();
      assertIdentity(identity, result.identity);
      if (
        Date.parse(period.from) !== Date.parse(result.period.from) ||
        Date.parse(period.toExclusive) !== Date.parse(result.period.toExclusive) ||
        period.timezone !== result.period.timezone
      )
        throw new Error('Provider returned a different reporting period');
      return result;
    },
  };
}
