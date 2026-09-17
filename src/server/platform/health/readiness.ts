const DEADLINE_MS = 2_000;
const CACHE_MS = 1_000;

/** One check per process, including after a caller times out. No orphan-query accumulation. */
export function createReadinessProbe(check: () => Promise<void>) {
  let pending: Promise<boolean> | undefined;
  let cached: { value: boolean; until: number } | undefined;
  return (): Promise<boolean> => {
    if (pending) return pending;
    if (cached && performance.now() < cached.until) return Promise.resolve(cached.value);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const operation = Promise.resolve()
      .then(check)
      .then(
        () => true,
        () => false,
      );
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve(false);
      }, DEADLINE_MS);
    });
    pending = Promise.race([operation, deadline]);
    void operation.then((value) => {
      clearTimeout(timer);
      cached = { value: !timedOut && value, until: performance.now() + CACHE_MS };
      pending = undefined;
    });
    return pending;
  };
}
