import { redirect } from 'next/navigation';
import { pitchModeEnabled } from './pitch-mode';
import { pitchHref } from '@/features/pitch/routes';
export function redirectPitchLegacy(
  path: string,
  search: Record<string, string | string[] | undefined>,
) {
  if (!pitchModeEnabled()) return;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (typeof value === 'string') params.set(key, value);
  redirect(pitchHref(path + '?' + params));
}
