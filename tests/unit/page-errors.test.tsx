import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createFrameworkReporter } from '@/server/platform/observability/framework';
import { PageFailure } from '@/shared/ui/PageFailure';
import { errorReference } from '@/shared/ui/error-reference';
import { onRequestError } from '../../instrumentation';

describe('page failure presentation and reporting', () => {
  it('correlates an opaque bounded reference without exposing message, stack or request metadata', () => {
    const write = vi.fn(); const report = createFrameworkReporter(write);
    const error = Object.assign(Error('PRIVATE_MESSAGE'), { digest: '123456789' });
    report(error, { path: '/invite?token=PRIVATE_TOKEN', method: 'GET', headers: { cookie: 'PRIVATE_COOKIE' } }, {
      routerKind: 'App Router', routePath: '/(public)/invite/page', routeType: 'render', renderSource: 'react-server-components', revalidateReason: undefined,
    });
    const event = write.mock.calls[0][0];
    expect(event).toMatchObject({ event: 'framework_error', reference: errorReference('123456789'), route: '/(public)/invite/page', method: 'GET', kind: 'render' });
    expect(JSON.stringify(event)).not.toMatch(/PRIVATE|123456789/);
    const retry = vi.fn(); render(<PageFailure digest={error.digest} onRetry={retry} />);
    expect(screen.getByRole('alert')).toHaveTextContent(event.reference);
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE');
    fireEvent.click(screen.getByRole('button', { name: 'โหลดหน้าใหม่' })); expect(retry).toHaveBeenCalledOnce();
  });
  it('uses bounded unknown categories for unfamiliar framework input and unsafe digests', () => {
    const write = vi.fn(); const report = createFrameworkReporter(write);
    report({ digest: 'PRIVATE_DIGEST' }, { path: 'PRIVATE_PATH', method: 'PRIVATE_METHOD', headers: {} }, {
      routerKind: 'App Router', routePath: '/customers/PRIVATE_ACTOR/page', routeType: 'render', revalidateReason: undefined,
    });
    expect(write.mock.calls[0][0]).toMatchObject({ reference: null, route: 'unknown', method: 'OTHER' });
    expect(JSON.stringify(write.mock.calls)).not.toContain('PRIVATE');
    for (const value of [undefined, '', 'a'.repeat(10000), '<script>', '123\n456', '123456789012345']) expect(errorReference(value)).toBeNull();
    render(<PageFailure digest="PRIVATE_DIGEST" onRetry={() => {}} />);
    expect(screen.queryByText(/รหัสอ้างอิง/)).not.toBeInTheDocument();
  });
  it('never invokes a digest getter or propagates a sink failure', () => {
    const getter = vi.fn(() => { throw Error('private'); });
    const error = Object.defineProperty({}, 'digest', { get: getter });
    const report = createFrameworkReporter(() => { throw Error('sink'); });
    expect(() => report(error, { path: '/', method: 'GET', headers: {} }, { routerKind: 'App Router', routePath: '/page', routeType: 'render', revalidateReason: undefined })).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('does nothing when the server error hook is not explicitly enabled', async () => {
    vi.stubEnv('LABSD_WEB_ERROR_OBSERVABILITY_ENABLED', '0'); vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    try { await expect(onRequestError(null, { path: '/', method: 'GET', headers: {} }, { routerKind: 'App Router', routePath: '/page', routeType: 'render', revalidateReason: undefined })).resolves.toBeUndefined(); }
    finally { vi.unstubAllEnvs(); }
  });
});
