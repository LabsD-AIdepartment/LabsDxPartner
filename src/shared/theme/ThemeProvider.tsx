'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
type Theme = 'light' | 'dark';
const Context = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
});
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('labsd-theme');
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
        document.documentElement.dataset.theme = saved;
      }
    } catch {
      /* Optional preference storage must never block the application. */
    }
  }, []);
  const toggle = () =>
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('labsd-theme', next);
      } catch {}
      return next;
    });
  return <Context.Provider value={{ theme, toggle }}>{children}</Context.Provider>;
}
export const useTheme = () => useContext(Context);
