import type { SessionValue } from '@/contracts/session';
export function pitchModeEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === 'development' && env.LABSD_PRESENTATION_MODE === 'pitch';
}
export function canUsePitch(session: SessionValue, env: NodeJS.ProcessEnv = process.env) {
  const member = session.memberships.find((entry) => entry.partnerId === session.activePartnerId);
  return (
    pitchModeEnabled(env) &&
    session.access === 'active' &&
    session.userId === env.LABSD_PITCH_USER_ID &&
    !!member &&
    member.partnerId === env.LABSD_PITCH_PARTNER_ID &&
    ['view_earnings', 'view_content', 'view_statements', 'view_ad_spend'].every((capability) =>
      member.capabilities.includes(capability as 'view_earnings'),
    )
  );
}
