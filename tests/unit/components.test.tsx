import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useQueryClient } from '@tanstack/react-query';
import { Money } from '@/shared/ui/Money';
import { ThemeProvider } from '@/shared/theme/ThemeProvider';
import { ThemeToggle } from '@/features/shell/ThemeToggle';
import { DataState } from '@/shared/ui/DataState';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { partnerKey } from '@/shared/query/keys';
const scope = { userId: 'user-1', partnerId: 'partner-1', permissionRevision: '1' };
describe('shared UI contracts', () => {
  it('shows unknown money with its reason without replacing it with zero', () => {
    render(<Money value={null} reason="รอหลักฐานยอดเงิน" />);
    expect(screen.getByLabelText('รอหลักฐานยอดเงิน')).toHaveTextContent('—');
  });
  it('reflects the current theme icon and labels the destination', async () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Day' })).toHaveAttribute(
      'title',
      'โหมด Dark',
    );
    fireEvent.click(screen.getByRole('button', { name: 'เปลี่ยนเป็นโหมด Day' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
  it('isolates cached amounts on an account switch', () => {
    function Probe({ write = false }: { write?: boolean }) {
      const client = useQueryClient();
      if (write)
        client.setQueryData(partnerKey(scope, 'earnings', 'overview'), { privateAmount: 100 });
      return <p>{client.getQueryCache().getAll().length ? 'cached' : 'empty'}</p>;
    }
    const result = render(
      <ScopedQueryProvider scope={scope}>
        <Probe write />
      </ScopedQueryProvider>,
    );
    expect(screen.getByText('cached')).toBeVisible();
    result.rerender(
      <ScopedQueryProvider scope={{ ...scope, userId: 'user-2' }}>
        <Probe />
      </ScopedQueryProvider>,
    );
    expect(screen.getByText('empty')).toBeVisible();
  });
  it('offers retry without hiding the error', () => {
    let tries = 0;
    render(<DataState state="error" onRetry={() => tries++} />);
    expect(screen.getByRole('alert')).toHaveTextContent('โหลดข้อมูลไม่สำเร็จ');
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }));
    expect(tries).toBe(1);
  });
});
