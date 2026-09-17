'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { restoreTheme } from './restore-theme';
import { usePathname } from 'next/navigation';
type Theme = 'light' | 'dark';
const Context = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
});
export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const saved = restoreTheme();
    if (saved) setTheme(saved);
  }, [pathname === '/login' || pathname === '/login/']);
  const toggle = () =>
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try {
        if (window.location.pathname.replace(/\/$/, '') !== '/login')
          localStorage.setItem('labsd-theme', next);
      } catch {}
      return next;
    });
  return <Context.Provider value={{ theme, toggle }}>{children}</Context.Provider>;
}
export const useTheme = () => useContext(Context);
