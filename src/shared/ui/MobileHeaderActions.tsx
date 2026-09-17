'use client';
import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';

type ProfileSurface = {
  actions: HTMLElement;
  badge: HTMLElement;
  /** Close the menu and focus its persistent trigger before opening an owned dialog. */
  activate: () => void;
};
const query = '(max-width: 600px)';
function subscribe(listener: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
const snapshot = () => window.matchMedia?.(query).matches ?? false;
const serverSnapshot = () => false;

/** Placement only: report and notification features continue to own their data and dialogs. */
export function useMobileHeaderActionsState() {
  const mobile = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [calendarTarget, setCalendarTarget] = useState<HTMLDivElement | null>(null);
  const [profile, setProfile] = useState<ProfileSurface | null>(null);
  return useMemo(
    () => ({ mobile, calendarTarget, setCalendarTarget, profile, setProfile }),
    [mobile, calendarTarget, profile],
  );
}
export const MobileHeaderActionsContext = createContext<ReturnType<
  typeof useMobileHeaderActionsState
> | null>(null);
export const useMobileHeaderActions = () => useContext(MobileHeaderActionsContext);
