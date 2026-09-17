import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePageMotion } from '@/shared/motion/page-motion';

let media: EventTarget & { matches: boolean };
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let cleanup: (() => void) | undefined;
const animate = vi.fn();
const cancellations: ReturnType<typeof vi.fn>[] = [];
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  cancellations.length = 0;
  animate.mockReset().mockImplementation(() => {
    const cancel = vi.fn();
    cancellations.push(cancel);
    return { cancel, onfinish: null };
  });
  vi.stubGlobal('Animation', class {});
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  document.body.innerHTML =
    '<main><h1>Wallet</h1><article><input value="5000"><ul><li>Existing</li></ul></article></main>';
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.unstubAllGlobals();
});
async function flush() {
  await Promise.resolve();
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}

describe('page motion lifecycle', () => {
  it('staggers individual content cards rather than moving their whole library as one block', async () => {
    document.body.innerHTML =
      '<main><article><h2>Library</h2><article>Clip 1</article><article>Clip 2</article></article></main>';
    cleanup = observePageMotion(document.body);
    await flush();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.contexts.map((element) => (element as HTMLElement).textContent)).toEqual([
      'Clip 1',
      'Clip 2',
    ]);
    expect(animate.mock.calls.map((call) => call[1].delay)).toEqual([0, 40]);
  });

  it('replays on repeat visits without replacing fields or their input state', async () => {
    const input = document.querySelector('input')!;
    input.value = '7200';
    cleanup = observePageMotion(document.body);
    await flush();
    expect(animate).toHaveBeenCalledTimes(2); // heading + outer card, not nested row
    cleanup();
    expect(cancellations.every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
    cleanup = observePageMotion(document.body);
    await flush();
    expect(animate).toHaveBeenCalledTimes(4);
    expect(document.querySelector('input')).toBe(input);
    expect(input.value).toBe('7200');
  });

  it('reveals newly loaded groups and retained cards when loading completes, without replaying unrelated groups', async () => {
    const card = document.querySelector('article')!;
    card.innerHTML = '<div data-loading="true">Loading</div>';
    cleanup = observePageMotion(document.body);
    await flush();
    animate.mockClear();
    card.innerHTML = '<ul><li>First loaded transaction</li><li>Second transaction</li></ul>';
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(card);
    animate.mockClear();
    card.querySelector('li')!.textContent = 'Updated amount';
    await flush();
    expect(animate).not.toHaveBeenCalled();
    card.querySelector('ul')!.insertAdjacentHTML('beforeend', '<li>New transaction</li>');
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('obeys reduced motion including preference changes while animations run', async () => {
    media.matches = true;
    cleanup = observePageMotion(document.body);
    await flush();
    expect(animate).not.toHaveBeenCalled();
    media.matches = false;
    media.dispatchEvent(new Event('change'));
    await flush();
    expect(animate).toHaveBeenCalledTimes(2);
    media.matches = true;
    media.dispatchEvent(new Event('change'));
    expect(cancellations.every((cancel) => cancel.mock.calls.length === 1)).toBe(true);
    document.querySelector('main')!.insertAdjacentHTML('beforeend', '<section>Later</section>');
    await flush();
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('replays dialogs on reopening and disconnects pending work on cleanup', async () => {
    document
      .querySelector('main')!
      .insertAdjacentHTML('beforeend', '<dialog><form>Request</form></dialog>');
    cleanup = observePageMotion(document.body);
    await flush();
    animate.mockClear();
    const dialog = document.querySelector('dialog')!;
    dialog.setAttribute('open', '');
    await flush();
    expect(animate).toHaveBeenCalledTimes(1);
    dialog.removeAttribute('open');
    await flush();
    dialog.setAttribute('open', '');
    await flush();
    expect(animate).toHaveBeenCalledTimes(2);
    cleanup();
    animate.mockClear();
    document
      .querySelector('main')!
      .insertAdjacentHTML('beforeend', '<article>After cleanup</article>');
    await flush();
    expect(animate).not.toHaveBeenCalled();
  });
});
