import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/shared/theme/ThemeProvider';
import { restoreTheme } from '@/shared/theme/restore-theme';
import { ThemeToggle } from '@/features/shell/ThemeToggle';
import { LoginPage } from '@/features/login/LoginPage';
import { CredentialEnvironmentProvider } from '@/features/login/CredentialEnvironment';

const route = vi.hoisted(() => ({ path: '/login' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  route.path = '/login';
  window.history.replaceState(null, '', '/login');
});
describe('login and workspace theme defaults', () => {
  it('boots login in Dark before hydration even with a saved Day preference', () => {
    localStorage.setItem('labsd-theme', 'light');
    window.eval(`(${restoreTheme.toString()})();`);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('keeps login toggles separate and restores workspace choice across navigation', () => {
    localStorage.setItem('labsd-theme', 'light');
    const page = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Day' }));
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Dark' }));
    expect(localStorage.getItem('labsd-theme')).toBe('light');
    route.path = '/overview';
    window.history.replaceState(null, '', route.path);
    page.rerender(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Dark' }));
    expect(restoreTheme()).toBe('dark');
    route.path = '/login';
    window.history.replaceState(null, '', route.path);
    page.rerender(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it.each([true, false])(
    'resets to Day only after successful sign-in (success=%s)',
    async (success) => {
      localStorage.setItem('labsd-theme', 'dark');
      const navigate = vi.fn(() => {
        window.history.replaceState(null, '', '/overview');
        expect(restoreTheme()).toBe('light');
      });
      const signIn = success
        ? vi.fn().mockResolvedValue({})
        : vi.fn().mockRejectedValue(new Error('failed'));
      render(
        <CredentialEnvironmentProvider
          value={{ signIn, navigate, request: vi.fn(), clearLink: vi.fn() }}
        >
          <LoginPage next="/overview" />
        </CredentialEnvironmentProvider>,
      );
      fireEvent.change(screen.getByLabelText('username'), { target: { value: 'partner' } });
      fireEvent.change(screen.getByLabelText('password'), { target: { value: 'test-password' } });
      fireEvent.submit(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }).closest('form')!);
      if (success) await waitFor(() => expect(navigate).toHaveBeenCalledWith('/overview'));
      else {
        await screen.findByRole('alert');
        expect(navigate).not.toHaveBeenCalled();
        expect(localStorage.getItem('labsd-theme')).toBe('dark');
      }
    },
  );
  it('uses route defaults when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(restoreTheme()).toBe('dark');
    window.history.replaceState(null, '', '/overview');
    expect(restoreTheme()).toBe('light');
  });
});
