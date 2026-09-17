import { describe, it, expect, vi } from 'vitest';
import { Writable } from 'node:stream';
import { createApiObserver, createApiSink, type ApiEvent } from '@/server/platform/observability/api';

describe('API observability', () => {
  it('contains asynchronous stream errors after write returns and stops writing to the failed sink', async () => {
    const write = vi.fn((_chunk, _encoding, done) => done(new Error('PRIVATE_DISK_ERROR')));
    const output = new Writable({ write });
    const sink = createApiSink(output);
    const route = createApiObserver(() => true, sink)('/api/access/[action]', (_r: Request) => new Response('business result'));
    expect(await (await route(new Request('https://local.test/'))).text()).toBe('business result');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(output.destroyed).toBe(true);
    expect(await (await route(new Request('https://local.test/'))).text()).toBe('business result');
    expect(write).toHaveBeenCalledOnce();
  });
  it('passes original request/context/body through and emits only safe metadata with a new ID', async () => {
    const sink = vi.fn(); const observe = createApiObserver(() => true, sink);
    const request = new Request('https://local.test/api/access/invite?token=PRIVATE_QUERY', {
      method: 'POST', headers: { 'x-request-id': 'FORGED_ID', authorization: 'Bearer PRIVATE_TOKEN', cookie: 'PRIVATE_COOKIE' },
      body: '{"password":"PRIVATE_PASSWORD"}',
    });
    const context = { params: Promise.resolve({ action: 'PRIVATE_ACTION' }) };
    const response = new Response('PRIVATE_RESPONSE', { status: 201 });
    response.headers.append('set-cookie', 'a=one; Path=/; HttpOnly');
    response.headers.append('set-cookie', 'b=two; Path=/; HttpOnly');
    const handler = vi.fn(async (r: Request, c: typeof context) => {
      expect(r).toBe(request); expect(c).toBe(context);
      expect(await r.text()).toContain('PRIVATE_PASSWORD'); return response;
    });
    const result = await observe('/api/access/[action]', handler)(request, context);
    expect(result).toBe(response);
    expect(result.headers.getSetCookie()).toEqual(['a=one; Path=/; HttpOnly', 'b=two; Path=/; HttpOnly']);
    expect(await result.text()).toBe('PRIVATE_RESPONSE');
    const event = sink.mock.calls[0][0];
    expect(event.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.headers.get('x-request-id')).toBe(event.requestId);
    expect(event).toMatchObject({ route: '/api/access/[action]', method: 'POST', status: 201, outcome: 'response' });
    expect(JSON.stringify(event)).not.toMatch(/PRIVATE|FORGED/);
  });

  it('isolates concurrent requests, including returned failure responses', async () => {
    const events: ApiEvent[] = []; const observe = createApiObserver(() => true, e => events.push(e));
    const route = observe('/api/v1/partner/overview', async (_r: Request) => Response.json({ code: 'UNAVAILABLE' }, { status: 503 }));
    const responses = await Promise.all(Array.from({ length: 20 }, () => route(new Request('https://local.test/'))));
    expect(new Set(events.map(e => e.requestId)).size).toBe(20);
    expect(responses.map(r => r.headers.get('x-request-id')).sort()).toEqual(events.map(e => e.requestId).sort());
    expect(events.every(e => e.status === 503 && e.outcome === 'response')).toBe(true);
  });

  it('contains unexpected handler failures without exposing error text, including HEAD', async () => {
    const sink = vi.fn(); const observe = createApiObserver(() => true, sink);
    const route = observe('/api/ready', async (_r: Request): Promise<Response> => { throw Error('postgresql://PRIVATE_SECRET'); });
    const response = await route(new Request('https://local.test/'));
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ code: 'INTERNAL_ERROR' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(sink.mock.calls[0][0].outcome).toBe('handler_exception');
    expect(JSON.stringify(sink.mock.calls)).not.toContain('PRIVATE_SECRET');
    expect(await (await route(new Request('https://local.test/', { method: 'HEAD' }))).text()).toBe('');
  });

  it('leaves opt-out completely unchanged and tolerates logging failures after business completion', async () => {
    const sink = vi.fn(() => { throw Error('sink unavailable'); });
    const response = new Response('ok');
    expect(await createApiObserver(() => false, sink)('/api/ready', (_r: Request) => response)(new Request('https://local.test/'))).toBe(response);
    expect(response.headers.has('x-request-id')).toBe(false); expect(sink).not.toHaveBeenCalled();
    expect(await createApiObserver(() => true, sink)('/api/access/[action]', (_r: Request) => response)(new Request('https://local.test/'))).toBe(response);
    expect(sink).toHaveBeenCalledOnce();
  });

  it('does not consume or await a streamed response and preserves immutable redirect headers', async () => {
    const sink = vi.fn(); const observe = createApiObserver(() => true, sink);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('chunk')); } });
    const response = new Response(stream, { headers: { 'content-disposition': 'attachment; filename="test.csv"' } });
    const result = await observe('/api/v1/partner/statements/[statementId]/export', (_r: Request) => response)(new Request('https://local.test/'));
    expect(result.body).toBe(stream); expect(result.bodyUsed).toBe(false); expect(sink).toHaveBeenCalledOnce(); await result.body!.cancel();
    const redirect = await observe('/api/auth/[...all]', (_r: Request) => Response.redirect('https://local.test/login'))(new Request('https://local.test/'));
    expect(redirect.status).toBe(302); expect(redirect.headers.get('location')).toBe('https://local.test/login'); expect(redirect.headers.has('x-request-id')).toBe(true);
  });

  it('suppresses healthy probe log volume while retaining failed probe events', async () => {
    const sink = vi.fn(); const observe = createApiObserver(() => true, sink);
    for (const path of ['/api/health', '/api/ready']) {
      expect((await observe(path, (_r: Request) => new Response(null))(new Request('https://local.test/'))).headers.has('x-request-id')).toBe(true);
      await observe(path, (_r: Request) => new Response(null, { status: 503 }))(new Request('https://local.test/'));
    }
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('bounds output pressure and reports dropped events on recovery without retaining them', () => {
    const writes: string[] = []; const output = { writableLength: 65536, write: (line: string) => writes.push(line) };
    const sink = createApiSink(output);
    const event: ApiEvent = { event: 'api_response', at: '2026-09-11T12:00:00.000Z', requestId: 'synthetic', route: '/api/ready', method: 'GET', status: 503, outcome: 'response', headersReadyMs: 12 };
    for (let i = 0; i < 100; i++) sink(event);
    expect(writes).toHaveLength(0); output.writableLength = 0; sink(event); sink(event);
    expect(JSON.parse(writes[0]).droppedSinceLastWrite).toBe(100);
    expect(JSON.parse(writes[1]).droppedSinceLastWrite).toBe(0);
    const rogue = { ...event, password: 'PRIVATE' }; sink(rogue);
    expect(writes.join('')).not.toContain('PRIVATE');
    expect(writes.every(line => Buffer.byteLength(line) < 1024)).toBe(true);
  });
});
