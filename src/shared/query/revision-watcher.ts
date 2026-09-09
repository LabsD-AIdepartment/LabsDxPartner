import { Changes, ChangeGroups, type ChangesValue, type ChangeGroup } from '@/contracts/changes';
import type { QueryScope } from './keys';
export class AccessLost extends Error {}
type Options = {
  scope: QueryScope;
  initial?: ChangesValue;
  load: (signal: AbortSignal) => Promise<unknown>;
  onChange: (groups: ChangeGroup[], snapshot: ChangesValue) => void;
  onAccessLost: () => void;
  onError?: (error: unknown) => void;
  random?: () => number;
};
/** Transport-independent revision polling; it never calculates or accumulates money. */
export class RevisionWatcher {
  private active = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private sequence = 0;
  private failures = 0;
  private baseline: ChangesValue | null = null;
  constructor(private readonly options: Options) {
    if (options.initial) {
      const initial = Changes.parse(options.initial);
      if (
        initial.partnerId !== options.scope.partnerId ||
        initial.permissionRevision !== options.scope.permissionRevision
      )
        throw new AccessLost('Initial membership scope changed');
      this.baseline = initial;
    }
  }
  setActive(active: boolean) {
    if (this.stopped || this.active === active) return;
    this.active = active;
    if (active) void this.check();
    else {
      this.sequence++;
      this.request?.abort();
      this.request = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
  }
  stop() {
    this.setActive(false);
    this.stopped = true;
  }
  async check() {
    if (!this.active || this.stopped || this.request) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const request = new AbortController();
    this.request = request;
    const sequence = ++this.sequence;
    try {
      const next = Changes.parse(await this.options.load(request.signal));
      if (sequence !== this.sequence || !this.active || this.stopped) return;
      if (
        next.partnerId !== this.options.scope.partnerId ||
        next.permissionRevision !== this.options.scope.permissionRevision
      )
        throw new AccessLost('Membership scope changed');
      const groups: ChangeGroup[] = [];
      if (this.baseline) {
        for (const group of ChangeGroups) {
          const key = `${group}Revision` as const;
          // Revisions are monotonic per scope. An out-of-order replica/response cannot lower our baseline.
          if (BigInt(next[key]) > BigInt(this.baseline[key])) groups.push(group);
          else next[key] = this.baseline[key];
        }
      }
      this.baseline = next;
      this.failures = 0;
      if (groups.length) this.options.onChange(groups, next);
    } catch (error) {
      if (sequence !== this.sequence || request.signal.aborted) return;
      if (error instanceof AccessLost) {
        this.options.onAccessLost();
        this.stop();
        return;
      }
      this.failures++;
      this.options.onError?.(error);
    } finally {
      if (sequence === this.sequence) {
        this.request = null;
        if (this.active && !this.stopped) {
          const delay =
            Math.min(300_000, 30_000 * 2 ** Math.min(this.failures, 4)) +
            Math.floor((this.options.random ?? Math.random)() * 5001);
          this.timer = setTimeout(() => void this.check(), delay);
        }
      }
    }
  }
}
