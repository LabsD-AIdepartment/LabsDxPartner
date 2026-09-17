/** Only process progress crosses IPC. No account IDs, credentials or provider payloads. */
export function reportWorkerProgress(attention: boolean) {
  if (process.connected) process.send?.({ type: 'cycle', attention }, () => {});
}
