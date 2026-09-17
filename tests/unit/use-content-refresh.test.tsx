import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useContent } from '@/features/content/useContent';
import type { ContentRequest, ContentTransport } from '@/features/content/model';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { initialReportContext as context } from '@/shared/routing/report-context';
import { contentFixture } from '../../dev/content-transport';
import type { ReactNode } from 'react';
const scope = { userId: 'refresh-user', partnerId: 'partner-a', permissionRevision: '1' };
const wrapper = ({ children }: { children: ReactNode }) => (
  <ScopedQueryProvider scope={scope}>{children}</ScopedQueryProvider>
);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('content detail automatic overlay refresh', () => {
  it('refetches the same detail at 60 seconds and stops the timer on unmount', async () => {
    const send = vi.fn<ContentTransport>(async (request) => contentFixture(request));
    const { result, unmount } = renderHook(
      () => {
        const query = useContent(send, { resource: 'detail', scope, context, contentId: 'clip-1' });
        return { data: query.data, isSuccess: query.isSuccess };
      },
      { wrapper },
    );
    await tick(1);
    expect(result.current.isSuccess).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const originalFinancialDetail = result.current.data!.data;
    await tick(59_998);
    expect(send).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({
      resource: 'detail',
      contentId: 'clip-1',
      scope,
      context,
    });
    expect(result.current.data?.data).toEqual(originalFinancialDetail);
    unmount();
    await tick(120_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('aborts an old scope refresh, does not show its late result, and polls only the new scope', async () => {
    let oldRequest: ContentRequest | undefined;
    let finishOld!: () => void;
    let aReads = 0;
    const send = vi.fn<ContentTransport>(async (request) => {
      if (request.scope.partnerId === scope.partnerId && ++aReads === 2) {
        oldRequest = request;
        await new Promise<void>((resolve) => {
          finishOld = resolve;
        });
      }
      return { ...contentFixture(request), requestId: `response-${request.scope.partnerId}` };
    });
    const { result, rerender, unmount } = renderHook(
      ({ partnerId }) => {
        const query = useContent(send, {
          resource: 'detail',
          scope: { ...scope, partnerId },
          context,
          contentId: 'clip-1',
        });
        return { data: query.data, isSuccess: query.isSuccess };
      },
      { wrapper, initialProps: { partnerId: 'partner-a' } },
    );
    await tick(1);
    await tick(60_000);
    expect(oldRequest?.signal.aborted).toBe(false);
    rerender({ partnerId: 'partner-b' });
    await tick(1);
    expect(oldRequest?.signal.aborted).toBe(true);
    expect(result.current.data?.requestId).toBe('response-partner-b');
    await act(async () => {
      finishOld();
    });
    await tick(1);
    expect(result.current.data?.requestId).toBe('response-partner-b');
    await tick(60_000);
    expect(send.mock.calls.filter(([r]) => r.scope.partnerId === 'partner-a')).toHaveLength(2);
    expect(send.mock.calls.filter(([r]) => r.scope.partnerId === 'partner-b')).toHaveLength(2);
    unmount();
  });
});
