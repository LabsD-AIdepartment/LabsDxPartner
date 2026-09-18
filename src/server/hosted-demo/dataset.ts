import { resolve } from 'node:path';
import { authorizePitchRequest } from '@/server/platform/pitch-access';
import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { DEFAULT_GENERATION, validateDataset } from '../../../dev/demo-dataset/dataset';
import { openExistingDatabaseReadOnly, readDataset } from '../../../dev/demo-dataset/db';
import { assertIdentityMatchesDataset, datasetIdForIdentity } from '../../../dev/demo-dataset/scope';
export async function handleDemoDatasetRequest(request: Request): Promise<Response> {
  if (!pitchModeEnabled() || process.env.LABSD_HOSTED_DEMO_ARTIFACT !== '1') return new Response(null, {status:404});
  const denied = await authorizePitchRequest(request);
  if (denied) return denied;
  let db: ReturnType<typeof openExistingDatabaseReadOnly> | undefined;
  try {
    if (!process.env.LABSD_HOSTED_DATA_DIR) throw new Error('Data directory missing');
    db = openExistingDatabaseReadOnly(resolve(process.env.LABSD_HOSTED_DATA_DIR, 'demo-dataset.sqlite'));
    const raw = readDataset(db, datasetIdForIdentity('a'), DEFAULT_GENERATION);
    if (!raw) throw new Error('Dataset missing');
    const data = validateDataset(raw);
    assertIdentityMatchesDataset(data, 'a');
    return Response.json({...data, clips:data.clips.map(clip => ({...clip, views:null}))},
      {headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  } catch { return Response.json({error:'unavailable'}, {status:503}); }
  finally { db?.close(); }
}
