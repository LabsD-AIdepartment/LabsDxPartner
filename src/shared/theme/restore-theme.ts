/** Optional presentation preference; can also run without the root context provider. */
export function restoreTheme(): 'light' | 'dark' {
  let theme: 'light' | 'dark' = 'light';
  if (window.location.pathname.replace(/\/$/, '') === '/login') {
    theme = 'dark';
  } else {
    try {
      const saved = localStorage.getItem('labsd-theme');
      if (saved === 'light' || saved === 'dark') theme = saved;
    } catch {
      /* Preference storage cannot prevent recovery UI. */
    }
  }
  document.documentElement.dataset.theme = theme;
  return theme;
}

/** Start each successful sign-in in Day, preserving later workspace toggles. */
export function resetWorkspaceTheme() {
  try {
    localStorage.setItem('labsd-theme', 'light');
  } catch {}
}
