import { request } from 'node:http';

export type ProbeResult = { status: 'ok' | 'attention' | 'unavailable'; reason: string };

/** Same-host health only. Never follows redirects or copies upstream data into output. */
export function checkWebEndpoint(port: number, path: '/api/health' | '/api/ready', timeoutMs: number): Promise<ProbeResult> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !['/api/health', '/api/ready'].includes(path) ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
    throw Error('Invalid web probe configuration');
  return new Promise((resolve) => {
    let complete = false;
    const finish = (reason: string, ok = false) => {
      if (complete) return;
      complete = true;
      clearTimeout(deadline);
      resolve({ status: ok ? 'ok' : 'unavailable', reason });
    };
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET', agent: false,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } }, (res) => {
      if (![200, 503].includes(res.statusCode ?? 0) ||
          !/^application\/json(?:;|$)/i.test(res.headers['content-type'] ?? '')) {
        finish('invalid-response'); res.destroy(); req.destroy(); return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024) { finish('invalid-response'); res.destroy(); req.destroy(); }
        else chunks.push(chunk);
      });
      res.on('error', () => finish('connection-error'));
      res.on('end', () => {
        if (complete) return;
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const expected = path === '/api/health' ? 'ok' : 'ready';
          if (res.statusCode === 200 && data?.status === expected) finish(expected, true);
          else if (path === '/api/ready' && res.statusCode === 503 && data?.status === 'unavailable')
            finish('not-ready');
          else finish('invalid-response');
        } catch { finish('invalid-response'); }
      });
    });
    // Absolute deadline covers trickling bodies, not just idle sockets.
    const deadline = setTimeout(() => { finish('timeout'); req.destroy(); }, timeoutMs);
    req.on('error', () => finish('connection-error'));
    req.end();
  });
}

export async function checkWebHealth(port: number, timeoutMs: number): Promise<ProbeResult> {
  const live = await checkWebEndpoint(port, '/api/health', timeoutMs);
  if (live.status !== 'ok') return live;
  return checkWebEndpoint(port, '/api/ready', timeoutMs);
}
