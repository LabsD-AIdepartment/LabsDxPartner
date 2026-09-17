import { createRotatingJournal } from '../../platform/observability/rotating-journal.mjs';

/** Worker formatter owns its unchanged envelope; caller owns its health-port lock.
 * @param {{directory:string, maxBytes:number, maxFiles:number}} options
 */
export function createWorkerJournal(options) {
  return createRotatingJournal(options, (event) => {
    // Formatter is the single field/meaning owner. Reject accidental extra payloads.
    const keys = [
      'schemaVersion',
      'event',
      'recordedAt',
      'supervisorRunId',
      'workerRunId',
      'sequence',
      'level',
      'platform',
      'state',
      'starts',
      'lastProgressAt',
      'attention',
      'reason',
      'attentionChange',
    ];
    if (Object.keys(event).some((key) => !keys.includes(key)) || event.schemaVersion !== 1)
      throw Error('Invalid journal event');
  });
}
