import { createRotatingJournal } from '../observability/rotating-journal.mjs';
import { serviceReasons, serviceStatuses } from './service-events';

const keys = ['event', 'at', 'monitorRunId', 'sequence', 'target', 'previous', 'status', 'reason'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the service formatter's small fixed envelope may cross into retained storage. */
export function createMonitorJournal(options: {
  directory: string;
  maxBytes: number;
  maxFiles: number;
}) {
  return createRotatingJournal(options, (event) => {
    if (
      Object.keys(event).length !== keys.length ||
      Object.keys(event).some((k) => !keys.includes(k)) ||
      event.event !== 'service_status' ||
      typeof event.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.at) ||
      !Number.isFinite(Date.parse(event.at)) ||
      typeof event.monitorRunId !== 'string' ||
      !uuid.test(event.monitorRunId) ||
      !Number.isSafeInteger(event.sequence) ||
      (event.sequence as number) < 1 ||
      !['web', 'facebook', 'tiktok'].includes(event.target as string) ||
      !(event.previous === null || serviceStatuses.has(event.previous as string)) ||
      !serviceStatuses.has(event.status as string) ||
      !serviceReasons.has(event.reason as string)
    )
      throw Error('Invalid service journal event');
  });
}
