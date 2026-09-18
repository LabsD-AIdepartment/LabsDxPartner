import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCredentialConfig } from '../src/server/modules/identity/credential-auth';
import { readAdSnapshotBindings } from '../src/server/modules/marketing-ads/facebook/snapshot-config';
import { openExistingDatabaseReadOnly, readDataset } from '../dev/demo-dataset/db';
import { DEFAULT_GENERATION, validateDataset } from '../dev/demo-dataset/dataset';
import { assertIdentityMatchesDataset, datasetIdForIdentity } from '../dev/demo-dataset/scope';

export function validateHostedDemoEnvironment(env: NodeJS.ProcessEnv) {
  for (const flag of ['LABSD_IDENTITY_ENABLED', 'LABSD_AD_SNAPSHOT_DATABASE', 'LABSD_AD_SNAPSHOT_ENABLED'])
    if (env[flag] !== '1') throw new Error('Hosted demonstration requires identity and database reports');
  for (const key of ['LABSD_PITCH_USER_ID','LABSD_PITCH_PARTNER_ID','LABSD_HOSTED_DATA_DIR'])
    if (!env[key]?.trim()) throw new Error('Hosted demonstration scope/data configuration missing');
  if (env.LABSD_PRESENTATION_MODE !== 'pitch') throw new Error('Hosted demonstration presentation missing');
  readCredentialConfig(env);
  const bindings = readAdSnapshotBindings(env);
  if (!bindings.length || bindings.some(binding => binding.identity !== 'a'))
    throw new Error('Hosted demonstration requires the approved sample identity');
  return env.LABSD_HOSTED_DATA_DIR!;
}

export function validateHostedDemoData(env: NodeJS.ProcessEnv) {
  const dir = validateHostedDemoEnvironment(env);
  for (const file of ['demo-dataset.sqlite','media/tendrix-video.mp4','media/tendrix-video-poster.jpg','media/tendrix-graphic.jpg']) {
    const stat=statSync(resolve(dir,file));
    if (!stat.isFile() || stat.size === 0) throw new Error('Hosted demonstration data missing');
  }
  const db=openExistingDatabaseReadOnly(resolve(dir,'demo-dataset.sqlite'));
  try {
    const integrity=db.prepare('pragma quick_check').get();
    if (integrity?.quick_check !== 'ok') throw new Error('Hosted demonstration data invalid');
    const data=validateDataset(readDataset(db,datasetIdForIdentity('a'),DEFAULT_GENERATION));
    assertIdentityMatchesDataset(data,'a');
  } finally {db.close();}
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {validateHostedDemoData(process.env);}
  catch {console.error('Hosted demonstration configuration or data failed validation');process.exitCode=1;}
}
