import { notFound } from 'next/navigation';
import {
  pitchModeEnabled,
  canUsePitch,
  pitchConnectedAdsVisible,
} from '@/server/platform/pitch-mode';
import { pitchSearch } from '@/features/pitch/routes';
import { requirePartnerAccess } from './requirePartnerAccess';
import { PartnerApplication } from '@/features/partner-application/PartnerApplication';
import type { PartnerScreen } from '@/features/partner-application/types';
import { readReportContext } from '@/shared/routing/report-context';
export async function renderPartnerPage(
  destination: string,
  screen: PartnerScreen,
  search: Record<string, string | string[] | undefined> = {},
) {
  const session = await requirePartnerAccess(destination);
  if (pitchModeEnabled()) {
    if (!canUsePitch(session)) notFound();
    const { PitchApplication } = await import('@partner-pitch');
    return (
      <PitchApplication
        session={session}
        screen={screen}
        search={pitchSearch(search)}
        showConnectedAds={pitchConnectedAdsVisible()}
      />
    );
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (typeof value === 'string') params.set(key, value);
  // Runtime defaults use the current Bangkok month. Preview fixture dates stay in dev adapters.
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month] = today.split('-').map(Number);
  if (!params.has('from')) params.set('from', `${year}-${String(month).padStart(2, '0')}-01`);
  if (!params.has('toExclusive'))
    params.set(
      'toExclusive',
      `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`,
    );
  return (
    <PartnerApplication
      initialSession={session}
      screen={screen}
      initialContext={readReportContext(params)}
    />
  );
}
