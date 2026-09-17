import { ConnectedAds, type ConnectedAdsValue } from '@/contracts/connected-ad-earnings';

export async function loadConnectedAds(
  request: { identity: string; from: string; toExclusive: string }, signal: AbortSignal,
): Promise<ConnectedAdsValue> {
  const query = new URLSearchParams({ identity: request.identity, clip: 'all', from: request.from, to: request.toExclusive });
  const response = await fetch(`/api/dev/ad-performance?${query}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]), cache: 'no-store', credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Connected ad reports unavailable');
  const data = ConnectedAds.parse(await response.json());
  signal.throwIfAborted();
  if (data.period.from !== request.from + 'T00:00:00+07:00' ||
      data.period.toExclusive !== request.toExclusive + 'T00:00:00+07:00' ||
      data.connections.some(c => c.performance &&
        (c.performance.period.from !== data.period.from || c.performance.period.toExclusive !== data.period.toExclusive)))
    throw new Error('Connected ad period mismatch');
  return data;
}

