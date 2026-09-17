/** Presentation only: observe rendered groups without remounting routes or touching queries. */
export function observePageMotion(root: HTMLElement) {
  const selector =
    'main [data-motion], main h1, main article, main section, main tbody tr, main li, main details, main form, dialog[open]';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let seen = new WeakSet<Element>();
  let frame = 0;
  const running = new Map<Element, Animation>();

  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    running.forEach((animation) => animation.cancel());
    running.clear();
  };
  const reveal = () => {
    frame = 0;
    if (reduced.matches || document.hidden) return;
    const fresh = [...root.querySelectorAll<HTMLElement>(selector)].filter(
      (element) =>
        !seen.has(element) &&
        !(element.matches('article, section') && element.querySelector('article')) &&
        !element.closest('[hidden], [inert], dialog:not([open])') &&
        element.getClientRects().length > 0,
    );
    const batch = new Set(fresh);
    fresh.forEach((element) => seen.add(element));
    // Animate the group once; nested rows enter separately when asynchronous data adds them later.
    const groups = fresh.filter((element) => {
      for (
        let parent = element.parentElement;
        parent && parent !== root;
        parent = parent.parentElement
      )
        if (batch.has(parent)) return false;
      return true;
    });
    groups.forEach((element, index) => {
      if (typeof element.animate !== 'function') return;
      running.get(element)?.cancel();
      const animation = element.animate(
        [
          { opacity: 0.25, translate: '0 12px' },
          { opacity: 1, translate: '0 0' },
        ],
        {
          duration: 440,
          delay: Math.min(index * 40, 200),
          easing: 'cubic-bezier(.2,.75,.25,1)',
          fill: 'backwards',
        },
      );
      running.set(element, animation);
      animation.onfinish = () => {
        if (running.get(element) === animation) running.delete(element);
      };
    });
  };
  const schedule = () => {
    if (!frame && !reduced.matches && !document.hidden) frame = requestAnimationFrame(reveal);
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      // Retained cards also enter when their loading state is replaced by actual data.
      const finishedLoading =
        [...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches('[data-loading="true"]') || node.querySelector('[data-loading="true"]')),
        ) ||
        (record.type === 'attributes' &&
          record.attributeName === 'data-loading' &&
          record.target instanceof Element &&
          record.target.getAttribute('data-loading') !== 'true');
      if (finishedLoading && record.target instanceof Element) {
        const group = record.target.closest('article, section, [data-motion]');
        if (group) seen.delete(group);
      }
      if (
        record.type === 'attributes' &&
        record.attributeName === 'open' &&
        record.target instanceof Element
      )
        seen.delete(record.target);
    }
    for (const [element, animation] of running) {
      if (!element.isConnected) {
        animation.cancel();
        running.delete(element);
      }
    }
    schedule();
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'data-loading'],
  });
  const preferenceChanged = () => {
    cancel();
    seen = new WeakSet();
    schedule();
  };
  reduced.addEventListener('change', preferenceChanged);
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => {
    observer.disconnect();
    reduced.removeEventListener('change', preferenceChanged);
    document.removeEventListener('visibilitychange', schedule);
    cancel();
  };
}
