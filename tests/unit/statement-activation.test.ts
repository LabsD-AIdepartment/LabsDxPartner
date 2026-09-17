import { afterEach, describe, expect, it, vi } from 'vitest';
import { statementPublicationEnabled } from '@/server/modules/statements/activation';
import { StaffFinanceError } from '@/features/staff-finance/http';
import { readyResponse } from '@/server/http/health';
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), factory: vi.fn() }));
vi.mock('@/server/modules/identity/runtime', () => ({ getIdentityRuntime: mocks.runtime }));
vi.mock('@/server/http/staff-finance', () => ({ createStaffFinanceHttp: mocks.factory }));
import { POST } from '../../app/api/v1/staff/periods/publish/route';
import { GET } from '../../app/api/v1/staff/periods/route';
const enabled = { LABSD_IDENTITY_ENABLED: '1', LABSD_FINANCE_ENABLED: '1', LABSD_STATEMENT_PUBLICATION_ENABLED: '1' };
const request = () => new Request('https://local.test/api/v1/staff/periods/publish?publicationEnabled=1', { method: 'POST', body: '{"publicationEnabled":true}' });
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('statement activation at the native route boundary', () => {
  it('requires exact opt-in and both dependencies', () => {
    expect(statementPublicationEnabled(enabled)).toBe(true);
    for (const key of Object.keys(enabled))
      for (const value of [undefined, '', '0', 'true', 'yes'])
        expect(statementPublicationEnabled({ ...enabled, [key]: value })).toBe(false);
  });
  it('blocks direct requests before identity or publisher construction when off, ignoring client overrides', async () => {
    for (const [key, value] of Object.entries(enabled)) vi.stubEnv(key, value);
    for (const value of [undefined, '0', 'true']) {
      vi.stubEnv('LABSD_STATEMENT_PUBLICATION_ENABLED', value);
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ code: 'PUBLICATION_DISABLED', retryable: false });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('preserves the original request, binding and existing authority checks when on; blocks a later request after off', async () => {
    for (const [key, value] of Object.entries(enabled)) vi.stubEnv(key, value);
    vi.stubEnv('BETTER_AUTH_URL', 'https://local.test');
    const assertBinding = vi.fn(async () => {});
    const handle = vi.fn(async () => Response.json({ code: 'FRESH_AUTH_REQUIRED' }, { status: 403 }));
    const partners = {};
    mocks.runtime.mockReturnValue({ assertBinding, partners });
    mocks.factory.mockReturnValue(handle);
    const original = request();
    expect((await POST(original)).status).toBe(403);
    expect(assertBinding).toHaveBeenCalledOnce();
    expect(mocks.factory).toHaveBeenCalledWith(partners, 'https://local.test', true);
    expect(handle).toHaveBeenCalledWith(original);
    vi.stubEnv('LABSD_STATEMENT_PUBLICATION_ENABLED', '0');
    expect((await POST(request())).status).toBe(503);
    expect(handle).toHaveBeenCalledOnce();
  });
  it('does not gate financial reads when publication is off', async () => {
    vi.stubEnv('LABSD_FINANCE_ENABLED', '1');
    vi.stubEnv('LABSD_STATEMENT_PUBLICATION_ENABLED', '0');
    vi.stubEnv('BETTER_AUTH_URL', 'https://local.test');
    const partners = {};
    mocks.runtime.mockReturnValue({ assertBinding: async () => {}, partners });
    mocks.factory.mockReturnValue(async () => Response.json({ readable: true }));
    expect(await (await GET(new Request('https://local.test/api/v1/staff/periods'))).json()).toEqual({ readable: true });
    expect(mocks.factory).toHaveBeenCalledWith(partners, 'https://local.test');
  });
  it('tells an old open client publication is disabled without a misleading login error', () => {
    expect(new StaffFinanceError('PUBLICATION_DISABLED').message).toBe('ยังไม่เปิดเผยแพร่งวด คุณยังดูข้อมูลและหลักฐานได้');
  });
  it('fails readiness for inconsistent publication dependencies but permits deliberate off', async () => {
    const runtime = () => ({ ready: async () => true });
    for (const key of ['LABSD_IDENTITY_ENABLED', 'LABSD_FINANCE_ENABLED']) {
      expect((await readyResponse(new Request('https://local.test/api/ready'), runtime, { ...enabled, [key]: '0' })).status).toBe(503);
    }
    expect((await readyResponse(new Request('https://local.test/api/ready'), runtime, { ...enabled, LABSD_STATEMENT_PUBLICATION_ENABLED: '0' })).status).toBe(200);
  });
});
