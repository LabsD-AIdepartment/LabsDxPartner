export type LogOutput = {
  readonly writableLength: number;
  write: (line: string) => unknown;
  on?: (event: 'error', listener: () => void) => unknown;
};

/** Best-effort JSON output; callers must project only approved fields. */
export function createBoundedLogWriter(output: LogOutput) {
  let dropped = 0;
  let failed = false;
  // Node streams can fail asynchronously after write() returns; never leave it unhandled.
  output.on?.('error', () => { failed = true; });
  return (event: Record<string, unknown>) => {
    try {
      if (failed || output.writableLength >= 65536) { dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1); return; }
      const line = JSON.stringify({ ...event, droppedSinceLastWrite: dropped }) + '\n';
      if (Buffer.byteLength(line) > 1024) { dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1); return; }
      output.write(line); dropped = 0;
    } catch { dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1); }
  };
}
