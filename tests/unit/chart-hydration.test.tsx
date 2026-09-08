import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
import { TrendChart } from '@/shared/charts/TrendChart';

it('hydrates server chart tooltips without regenerating the tree', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const element = (
    <TrendChart
      points={[
        { date: '2026-08-01', amount: { currency: 'THB', minor: '900719925474099301' } },
        { date: '2026-08-02', amount: { currency: 'THB', minor: '-501' } },
      ]}
    />
  );
  const host = document.createElement('div');
  host.innerHTML = renderToString(element);
  document.body.append(host);
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(host, element, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.textContent).toContain('฿9,007,199,254,740,993.01');
    expect(host.textContent).toContain('-฿5.01');
  } finally {
    await act(async () => root!.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
