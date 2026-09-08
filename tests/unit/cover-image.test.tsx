import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CoverImage } from '@/shared/ui/CoverImage';

it('handles an image that already failed before React attached its error listener', () => {
  const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
  try {
    const view = render(<CoverImage src="/missing.png" alt="ภาพปก" />);
    expect(screen.getByRole('img', { name: 'ภาพปก — ไม่สามารถโหลดภาพได้' }).tagName).toBe('SPAN');
    width.mockReturnValue(100);
    view.rerender(<CoverImage src="/replacement.png" alt="ภาพปก" />);
    expect(screen.getByRole('img', { name: 'ภาพปก' })).toHaveAttribute('src', '/replacement.png');
  } finally {
    complete.mockRestore();
    width.mockRestore();
  }
});
