export function previewWait(signal: AbortSignal, ms: number | null = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (ms !== null)
      timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
  });
}
