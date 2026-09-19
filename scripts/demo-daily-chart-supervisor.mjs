import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { superviseWorker } from '../src/server/modules/marketing-ads/worker-supervisor.mjs';
/** @param {{root:string, env:NodeJS.ProcessEnv, signal:AbortSignal}} options */
export function startDailyChartFillWorker({ root, env, signal }) {
  if (env.LABSD_DEMO_DAILY_CHART_FILL_ENABLED !== '1' || env.LABSD_PRESENTATION_MODE !== 'pitch')
    return;
  if (env.NODE_ENV !== 'development' && env.LABSD_HOSTED_DEMO_ENABLED !== '1') return;
  let last = '';
  void superviseWorker(
    () =>
      spawn(
        process.execPath,
        ['--import', 'tsx', resolve(root, 'scripts/demo-daily-chart-worker.ts')],
        {
          cwd: root,
          env,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      ),
    {
      signal,
      onState(state) {
        const value = JSON.stringify({
          worker: 'demo-daily-chart-fill',
          state: state.state,
          attention: state.attention,
        });
        if (value !== last) {
          console.log(value);
          last = value;
        }
      },
    },
  )
    .then((result) => {
      if (result.failed)
        console.error('Demo daily chart fill stopped; original data remains available');
    })
    .catch(() => {
      console.error('Demo daily chart fill supervisor unavailable');
    });
}
