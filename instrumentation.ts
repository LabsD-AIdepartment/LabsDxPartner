import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.LABSD_WEB_ERROR_OBSERVABILITY_ENABLED !== '1') return;
  try {
    const { reportFrameworkError } = await import('@/server/platform/observability/framework');
    reportFrameworkError(error, request, context);
  } catch { /* Reporting must not create another framework failure. */ }
};
