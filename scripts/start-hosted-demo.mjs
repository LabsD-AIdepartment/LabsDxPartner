import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { superviseWorker } from '../src/server/modules/marketing-ads/worker-supervisor.mjs';
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(resolve(root, '.next/required-server-files.json'), 'utf8'));
if (config.config.env.LABSD_HOSTED_DEMO_ARTIFACT !== '1') throw new Error('Hosted demonstration artifact required');
if (process.env.LABSD_HOSTED_DEMO_ENABLED === '1') {
  const dir = process.env.LABSD_HOSTED_DATA_DIR;
  if (!dir || !['demo-dataset.sqlite', 'media/tendrix-video.mp4', 'media/tendrix-video-poster.jpg', 'media/tendrix-graphic.jpg'].every(file => existsSync(resolve(dir, file))))
    throw new Error('Hosted demonstration data is not provisioned');
}
const env = {...process.env, NODE_ENV:'production'};
for (const profile of JSON.parse(env.LABSD_FACEBOOK_PROFILES || '[]')) {
  delete env[profile.tokenEnv];
  if (profile.appSecretEnv) delete env[profile.appSecretEnv];
}
delete env.LABSD_LOCAL_KEYCHAIN_REFS;
const controller = new AbortController();
const web = spawn(process.execPath, [resolve(root,'node_modules/next/dist/bin/next'),'start','--hostname','0.0.0.0','--port',process.env.PORT || '3000'], {cwd:root,env,stdio:'inherit'});
let stopping = false;
let failed = false;
const stop = () => { stopping = true; controller.abort(); web.kill('SIGTERM'); };
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,stop);
web.once('error', () => {controller.abort(); process.exitCode=1;});
web.once('exit', code => {controller.abort(); process.exitCode=failed ? 1 : stopping ? 0 : code ?? 1;});
if (process.env.LABSD_EXTERNAL_DATA_WORKER_ENABLED === '1') {
  if (process.env.LABSD_AD_SNAPSHOT_DATABASE !== '1') throw new Error('Worker requires database read mode');
  let last='';
  void superviseWorker(() => spawn(process.execPath,['--import','tsx',resolve(root,'scripts/external-data-worker.ts')], {
    cwd:root, env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe','ipc'],
  }), {signal:controller.signal,onState(state){
    const next=JSON.stringify({worker:'external-data',state:state.state,attention:state.attention,reason:state.reason});
    if(next!==last){console.log(next);last=next;}
  }}).then(result => {if(result.failed){failed=true;stop();process.exitCode=1;}}).catch(()=>{failed=true;stop();process.exitCode=1;});
}
