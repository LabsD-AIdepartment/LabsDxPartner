import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { authorizePitchRequest } from '@/server/platform/pitch-access';
import { fillEnabled, fillDirectory, readDailyFill } from './store';
import { bangkokDay } from './model';
export async function handleDailyFill(request: Request) {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (!pitchModeEnabled() || !fillEnabled()) return new Response(null, { status: 404, headers });
  const denied = await authorizePitchRequest(request);
  if (denied) {
    denied.headers.set('cache-control', 'private, no-store');
    return denied;
  }
  try {
    const directory = fillDirectory();
    if (!directory) throw new Error('Data directory missing');
    const data = await readDailyFill(directory);
    const today = bangkokDay(new Date());
    // Even an accidentally future-dated store cannot expose future demo points.
    return Response.json(
      {
        ...data,
        through: data.through < today ? data.through : today,
        rows: data.rows.filter((row) => row.date <= today),
      },
      { headers },
    );
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 503, headers });
  }
}
