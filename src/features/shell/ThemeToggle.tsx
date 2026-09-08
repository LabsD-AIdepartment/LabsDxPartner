'use client';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/shared/theme/ThemeProvider';
import { Button } from '@/shared/ui/Button';
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      icon
      onClick={toggle}
      aria-label={theme === 'dark' ? 'เปลี่ยนเป็นโหมด Day' : 'เปลี่ยนเป็นโหมด Dark'}
      title={theme === 'dark' ? 'โหมด Dark' : 'โหมด Day'}
    >
      {theme === 'dark' ? <Moon size={19} /> : <Sun size={19} />}
    </Button>
  );
}
