import { randomUUID } from 'node:crypto';
import type { Instrumentation } from 'next';
import templates from './route-templates.json';
import { createBoundedLogWriter } from './sink';
import { errorReference } from '@/shared/ui/error-reference';

const knownRoutes = new Set(templates);
const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const allowedTypes = new Set(['render', 'route', 'action', 'proxy']);
const allowedSources = new Set(['react-server-components', 'react-server-components-payload', 'server-rendering']);
type Inputs = Parameters<Instrumentation.onRequestError>;
export function createFrameworkReporter(write: (event: Record<string, unknown>) => void) {
  return (error: Inputs[0], request: Inputs[1], context: Inputs[2]) => {
    try {
      const digest = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'digest')?.value : undefined;
      write({ event: 'framework_error', at: new Date().toISOString(), eventId: randomUUID(),
        reference: errorReference(digest),
        route: knownRoutes.has(context.routePath) ? context.routePath : 'unknown',
        method: allowedMethods.has(request.method) ? request.method : 'OTHER',
        kind: allowedTypes.has(context.routeType) ? context.routeType : 'unknown',
        source: context.renderSource && allowedSources.has(context.renderSource) ? context.renderSource : 'unknown',
      });
    } catch { /* Never expose error details or cause a second framework exception. */ }
  };
}
export const reportFrameworkError = createFrameworkReporter(createBoundedLogWriter(process.stdout));
