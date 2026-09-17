import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DateRangePicker } from '@/shared/ui/DateRangePicker';
import { addDays, dateNumber, monthDays, shiftMonth, validDateRange } from '@/shared/ui/date-range';
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
});
afterEach(() => vi.restoreAllMocks());
const value = { from: '2026-07-01', toExclusive: '2026-09-01' };
function mount() {
  const apply = vi.fn();
  render(<DateRangePicker value={value} onApply={apply} />);
  const button = screen.getByRole('button', { name: 'เลือกช่วงวันที่' });
  button.focus();
  fireEvent.click(button);
  return { apply, button };
}
describe('inclusive date ranges', () => {
  it('accepts real leap days and rejects normalized impossible dates', () => {
    expect(dateNumber('2024-02-29')).not.toBeNull();
    expect(dateNumber('2026-02-29')).toBeNull();
    expect(dateNumber('2026-04-31')).toBeNull();
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthDays('2024-02').filter(Boolean)).toHaveLength(29);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
  it('allows one day and exactly 366 days but rejects reversed or longer ranges', () => {
    expect(validDateRange('2024-01-01', '2024-01-01')).toBe(true);
    expect(validDateRange('2024-01-01', '2024-12-31')).toBe(true);
    expect(validDateRange('2024-01-01', '2025-01-01')).toBe(false);
    expect(validDateRange('2026-01-02', '2026-01-01')).toBe(false);
  });
  it('commits inclusive end as exclusive only after Apply and highlights selected range', () => {
    const { apply, button } = mount();
    expect(screen.getByRole('button', { name: /^ถึงวันที่/ })).toHaveTextContent('31/08/2026');
    const july = within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' }));
    fireEvent.click(july.getByRole('button', { name: '2026-07-05' }));
    fireEvent.click(july.getByRole('button', { name: '2026-07-09' }));
    expect(july.getByRole('button', { name: '2026-07-07' })).toHaveAttribute(
      'data-in-range',
      'true',
    );
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    expect(apply).toHaveBeenCalledWith({ from: '2026-07-05', toExclusive: '2026-07-10' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });
  it.each(['cancel', 'escape', 'outside'])(
    'discards draft on %s and restores trigger focus',
    (action) => {
      const { apply, button } = mount();
      fireEvent.click(screen.getByRole('button', { name: '2026-08-02' }));
      if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
      else if (action === 'escape')
        fireEvent(
          screen.getByRole('dialog'),
          new Event('cancel', { bubbles: true, cancelable: true }),
        );
      else fireEvent.click(screen.getByRole('dialog'), { clientX: -1, clientY: -1 });
      expect(apply).not.toHaveBeenCalled();
      expect(button).toHaveFocus();
      fireEvent.click(button);
      expect(screen.getByRole('button', { name: /^เริ่มวันที่/ })).toHaveTextContent('01/07/2026');
    },
  );
  it('keeps invalid drafts uncommitted and permits a single-day selection', () => {
    const { apply } = mount();
    fireEvent.click(screen.getByRole('button', { name: /^ถึงวันที่/ }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'ปี 2' }), {
      target: { value: '2027' },
    });
    fireEvent.click(screen.getByRole('button', { name: '2027-08-02' }));
    expect(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' })).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '2027-08-02' }));
    fireEvent.click(screen.getByRole('button', { name: 'ใช้ช่วงวันที่' }));
    expect(apply).toHaveBeenCalledWith({ from: '2027-08-02', toExclusive: '2027-08-03' });
  });
  it('uses non-editable endpoint buttons and changes selection intent only on activation', () => {
    mount();
    const start = screen.getByRole('button', { name: /^เริ่มวันที่/ });
    const end = screen.getByRole('button', { name: /^ถึงวันที่/ });
    expect(screen.getByRole('dialog').querySelector('input[type="date"]')).toBeNull();
    expect(start).toHaveAttribute('aria-pressed', 'true');
    end.focus();
    expect(start).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(end);
    expect(end).toHaveAttribute('aria-pressed', 'true');
    start.focus();
    expect(end).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '2026-08-15' }));
    expect(start).toHaveTextContent('01/07/2026');
    expect(end).toHaveTextContent('15/08/2026');
    fireEvent.click(start);
    fireEvent.click(screen.getByRole('button', { name: '2026-07-02' }));
    expect(start).toHaveTextContent('02/07/2026');
    expect(end).toHaveTextContent('15/08/2026');
  });
  it('navigates across month boundaries with arrow keys', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      setTimeout(() => fn(0), 0);
      return 1;
    });
    mount();
    const july = within(screen.getByRole('region', { name: 'ปฏิทินเริ่มต้น' }));
    const last = july.getByRole('button', { name: '2026-07-31' });
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    await vi.waitFor(() => expect(july.getByRole('button', { name: '2026-08-01' })).toHaveFocus());
  });
});
