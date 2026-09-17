let namespace = '';
/** Called only after the native session has been verified, before sample consumers mount. */
export function bindPitchStorage(userId: string, partnerId: string) {
  namespace = `pitch:${encodeURIComponent(userId)}:${encodeURIComponent(partnerId)}:`;
}
export function pitchStorageKey(key: string) {
  return namespace + key;
}
