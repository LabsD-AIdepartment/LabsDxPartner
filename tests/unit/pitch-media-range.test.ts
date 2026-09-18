// @vitest-environment node
import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const access = vi.hoisted(() => ({ enabled: vi.fn(), authorize: vi.fn() }));
vi.mock('@/server/platform/pitch-mode', () => ({ pitchModeEnabled: access.enabled }));
vi.mock('@/server/platform/pitch-access', () => ({ authorizePitchRequest: access.authorize }));
import { GET, HEAD } from '../../app/media/ad-samples/[file]/route';
let root: string;
const bytes = Buffer.from('0123456789');
const context = (file = 'tendrix-video.mp4') => ({ params: Promise.resolve({ file }) });
const request = (range?: string, extra?: Record<string, string>) =>
  new Request('https://partner.example/media/ad-samples/tendrix-video.mp4', {
    headers: { ...(range ? { Range: range } : {}), ...extra },
  });
beforeAll(() => {
  const parent = resolve('.agent-work/runtime/tmp');
  mkdirSync(parent, { recursive: true });
  root = mkdtempSync(resolve(parent, 'media-range-'));
  mkdirSync(resolve(root, 'media'));
  writeFileSync(resolve(root, 'media/tendrix-video.mp4'), bytes);
  writeFileSync(resolve(root, 'media/tendrix-graphic.jpg'), '');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  vi.stubEnv('LABSD_HOSTED_DATA_DIR', root);
  access.enabled.mockReturnValue(true);
  access.authorize.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['bytes=0-1', '01', 'bytes 0-1/10'],
  ['bytes=3-', '3456789', 'bytes 3-9/10'],
  ['bytes=-3', '789', 'bytes 7-9/10'],
  ['bytes=8-999999999999999999999', '89', 'bytes 8-9/10'],
  ['bytes=-99999999999999999999', '0123456789', 'bytes 0-9/10'],
])(
  'returns exact video bytes for %s including Safari first-two-byte probes',
  async (range, body, contentRange) => {
    const response = await GET(request(range), context());
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(contentRange);
    expect(response.headers.get('content-length')).toBe(String(body.length));
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(await response.text()).toBe(body);
  },
);
it.each(['bytes=10-', 'bytes=99999999999999999999-', 'bytes=-0'])(
  'rejects unsatisfiable %s without returning file content',
  async (range) => {
    const response = await GET(request(range), context());
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    expect(response.headers.get('content-length')).toBe('0');
    expect(await response.text()).toBe('');
  },
);
it.each([undefined, 'bytes=8-2', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1', 'bytes=NaN-'])(
  'serves full bytes when no usable range exists: %s',
  async (range) => {
    const response = await GET(request(range), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.has('content-range')).toBe(false);
    expect(await response.text()).toBe(bytes.toString());
  },
);
it('falls back to a complete response for unverifiable If-Range', async () => {
  const response = await GET(request('bytes=0-1', { 'If-Range': '"old-version"' }), context());
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(bytes.toString());
});
it('answers HEAD without a body and ignores its Range header', async () => {
  const response = await HEAD(new Request(request('bytes=0-1'), { method: 'HEAD' }), context());
  expect(response.status).toBe(200);
  expect(response.headers.get('content-length')).toBe('10');
  expect(response.headers.get('accept-ranges')).toBe('bytes');
  expect(await response.text()).toBe('');
});
it.each([401, 403])('preserves authorization for GET ranges and HEAD: %s', async (status) => {
  access.authorize.mockImplementation(async () => new Response(null, { status }));
  for (const handler of [GET, HEAD]) {
    const response = await handler(request('bytes=0-1'), context());
    expect(response.status).toBe(status);
    expect(response.headers.has('content-range')).toBe(false);
    expect(await response.text()).toBe('');
  }
});
it('keeps flag-off and non-allowlisted paths inaccessible', async () => {
  access.enabled.mockReturnValue(false);
  expect((await GET(request(), context())).status).toBe(404);
  expect(access.authorize).not.toHaveBeenCalled();
  access.enabled.mockReturnValue(true);
  for (const file of ['../tendrix-video.mp4', 'unknown.mp4', 'toString']) {
    expect((await GET(request(), context(file))).status).toBe(404);
  }
  expect((await GET(request(), context('tendrix-video-poster.jpg'))).status).toBe(404);
});
it('handles empty files without invalid stream offsets', async () => {
  const empty = await GET(request(), context('tendrix-graphic.jpg'));
  expect(empty.status).toBe(200);
  expect(await empty.text()).toBe('');
  expect((await GET(request('bytes=0-'), context('tendrix-graphic.jpg'))).status).toBe(416);
});
