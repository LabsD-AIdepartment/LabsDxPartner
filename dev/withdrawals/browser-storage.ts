import { pitchStorageKey } from '../pitch-storage';
import type { DevKeyValueStorage } from './store';

// Development-only: ONE shared, stable, lazy browser sessionStorage adapter for the withdrawal
// previews. Both preview pages import THIS object so the runtime registry (keyed by storage OBJECT
// identity) resolves a single controller per scope across pages.
//
// window/sessionStorage is touched ONLY inside a method call — never at module import — so importing
// this module never throws in a non-browser/SSR context, and any real access fault (disabled
// storage, quota, security error) propagates to the PersistedStore's try/catch so fault handling
// (warnings, no-overwrite) stays effective. This replaces the previously-private per-page
// `browserStorage` literal; do not create a second wrapper per page.
export const browserWithdrawalStorage: DevKeyValueStorage = {
  getItem: (key) => window.sessionStorage.getItem(pitchStorageKey(key)),
  setItem: (key, value) => window.sessionStorage.setItem(pitchStorageKey(key), value),
  removeItem: (key) => window.sessionStorage.removeItem(pitchStorageKey(key)),
};
