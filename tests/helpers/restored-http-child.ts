// Test-owned listener for an already-built, isolated recovery artifact.
import { createServer } from 'node:http';
import next from 'next';

if (!process.send || process.argv.length !== 3) process.exit(1);
let attempts = 0;
globalThis.fetch = async () => {
  attempts++;
  throw new Error('Outbound fetch disabled in recovery acceptance');
};
const app = next({ dev: false, dir: process.argv[2], hostname: '127.0.0.1' });
await app.prepare();
const handler = app.getRequestHandler();
const server = createServer((request, response) => void handler(request, response));
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.send!({ port: address.port });
});
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  server.close();
  server.closeAllConnections();
  await app.close();
  if (process.connected)
    process.send?.({ stopped: true, providerFetchAttempts: attempts }, () => process.exit(0));
  else process.exit(0);
}
process.on('message', (message) => {
  if (message === 'stop') void stop();
});
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
