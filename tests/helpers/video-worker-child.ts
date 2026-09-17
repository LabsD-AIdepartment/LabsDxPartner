/** Real process boundary for durable worker crash acceptance; launched only by integration tests. */
import { connectTestDatabase } from '../../scripts/test-database.mjs';
import { createConfiguredShopVideoWorker } from '../../src/server/modules/marketing-ads/tiktok-shop/video-composition';
const sql = await connectTestDatabase();
try {
  const worker = createConfiguredShopVideoWorker(sql, process.env, async (tx) => {
    const [row] =
      await tx`select namespace from portal_marketing.connections where id=${process.env.TEST_VIDEO_CONNECTION!}`;
    if (!row || row.namespace !== process.env.TEST_VIDEO_NAMESPACE)
      throw new Error('Test binding mismatch');
  });
  if (!worker) throw new Error('Worker disabled');
  // No timers/clock overrides: every iteration uses the configured native planner/leases.
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await worker.run(new AbortController().signal);
    process.send?.({ type: 'result', result });
    if (result.results.some((r) => r.state === 'published')) break;
    if (!result.results.some((r) => r.state === 'progress'))
      throw new Error('Unexpected worker result');
  }
} finally {
  await sql.end();
}
