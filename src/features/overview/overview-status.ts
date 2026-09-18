import type { OverviewValue } from '@/contracts/overview';

/** Move enrichment issues locally only when their base accounting provenance is known. */
export function overviewPageStatus(data: OverviewValue) {
  if (
    data.dataState === 'partial' &&
    data.accountingStatus &&
    data.earnings.connectedAdEarnings?.length
  ) {
    return data.accountingStatus;
  }
  return { state: data.dataState, reasons: data.reasons };
}
