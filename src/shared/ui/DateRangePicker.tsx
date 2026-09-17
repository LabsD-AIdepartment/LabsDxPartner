'use client';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { addDays, dateNumber, monthDays, shiftMonth, validDateRange } from './date-range';
import styles from './date-range.module.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Range = { from: string; toExclusive: string };
const displayDate = (date: string) =>
  dateNumber(date) === null ? '—' : date.split('-').reverse().join('/');
export function DateRangePicker({
  value,
  onApply,
  triggerTarget,
}: {
  value: Range;
  onApply: (value: Range) => void;
  triggerTarget?: HTMLElement | null;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const triggerButton = (
    <Button
      ref={trigger}
      icon
      aria-label="เลือกช่วงวันที่"
      title={`${value.from} – ${addDays(value.toExclusive, -1)}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(true)}
    >
      <CalendarDays size={20} aria-hidden />
    </Button>
  );
  return (
    <>
      {triggerTarget ? createPortal(triggerButton, triggerTarget) : triggerButton}
      {open &&
        createPortal(
          <RangeDialog
            value={value}
            anchor={trigger}
            triggerTarget={triggerTarget}
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
            onApply={onApply}
          />,
          document.body,
        )}
    </>
  );
}
function RangeDialog({
  value,
  anchor,
  onClose,
  onApply,
  triggerTarget,
}: {
  value: Range;
  anchor: RefObject<HTMLButtonElement | null>;
  triggerTarget?: HTMLElement | null;
  onClose: () => void;
  onApply: (value: Range) => void;
}) {
  const [from, setFrom] = useState(value.from);
  const [end, setEnd] = useState(addDays(value.toExclusive, -1));
  const fallback = new Date().toISOString().slice(0, 7);
  const [months, setMonths] = useState([
    dateNumber(from) !== null ? from.slice(0, 7) : fallback,
    dateNumber(end) !== null ? end.slice(0, 7) : fallback,
  ]);
  const [selecting, setSelecting] = useState<'start' | 'end'>('start');
  const dialog = useRef<HTMLDialogElement>(null);
  const valid = validDateRange(from, end);
  const position = useCallback(() => {
    const element = dialog.current;
    if (!element) return;
    const rect = anchor.current?.getBoundingClientRect();
    const normalWidth = window.innerWidth <= 640 ? 256 : 448;
    const width = Math.min(normalWidth, window.innerWidth - 24);
    element.style.width = `${width}px`;
    element.style.left = `${Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - width - 12))}px`;
    element.style.top = `${Math.max(12, Math.min((rect?.bottom ?? 0) + 10, window.innerHeight - element.getBoundingClientRect().height - 12))}px`;
  }, [anchor]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    position();
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('resize', position);
      element.close();
      anchor.current?.focus();
    };
  }, [anchor, position]);
  useLayoutEffect(position, [position, triggerTarget]);
  const setMonth = (index: number, month: string) =>
    setMonths((current) => current.map((v, i) => (i === index ? month : v)));
  const choose = (date: string) => {
    if (selecting === 'start') {
      setFrom(date);
      if (date > end) setEnd(date);
      setSelecting('end');
    } else if (date < from) {
      setFrom(date);
      setEnd(date);
      setSelecting('end');
    } else {
      setEnd(date);
      setSelecting('start');
    }
  };
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, date: string, index: number) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -new Date(date + 'T00:00:00Z').getUTCDay(),
      End: 6 - new Date(date + 'T00:00:00Z').getUTCDay(),
    };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = addDays(date, offsets[event.key]);
    if (!next) return;
    setMonth(index, next.slice(0, 7));
    requestAnimationFrame(() =>
      dialog.current
        ?.querySelector<HTMLButtonElement>(`[data-panel="${index}"] [data-date="${next}"]`)
        ?.focus(),
    );
  };
  return (
    <dialog
      ref={dialog}
      className={styles.popover}
      aria-label="เลือกช่วงวันที่"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          onClose();
      }}
    >
      <div className={styles.rangeFields}>
        <button
          type="button"
          aria-pressed={selecting === 'start'}
          onClick={() => setSelecting('start')}
        >
          <span>เริ่มวันที่</span>
          <span>{displayDate(from)}</span>
        </button>
        <button
          type="button"
          aria-pressed={selecting === 'end'}
          onClick={() => setSelecting('end')}
        >
          <span>ถึงวันที่</span>
          <span>{displayDate(end)}</span>
        </button>
      </div>
      <div className={styles.months}>
        {months.map((month, index) => (
          <section
            key={index}
            className={styles.month}
            data-panel={index}
            aria-label={index === 0 ? 'ปฏิทินเริ่มต้น' : 'ปฏิทินสิ้นสุด'}
          >
            <div className={styles.navigation}>
              <button
                type="button"
                aria-label={`เดือนก่อนหน้า ${index + 1}`}
                onClick={() => setMonth(index, shiftMonth(month, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <select
                aria-label={`เดือน ${index + 1}`}
                value={month.slice(5)}
                onChange={(e) => setMonth(index, `${month.slice(0, 4)}-${e.target.value}`)}
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={String(i + 1).padStart(2, '0')}>
                    {name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`ปี ${index + 1}`}
                type="number"
                min="1"
                max="9999"
                value={Number(month.slice(0, 4))}
                onChange={(e) => {
                  const year = Number(e.target.value);
                  if (Number.isInteger(year) && year >= 1 && year <= 9999)
                    setMonth(index, `${String(year).padStart(4, '0')}-${month.slice(5)}`);
                }}
              />
              <button
                type="button"
                aria-label={`เดือนถัดไป ${index + 1}`}
                onClick={() => setMonth(index, shiftMonth(month, 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div
              className={styles.days}
              role="group"
              aria-label={`${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`}
            >
              {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
                <span key={day} className={styles.weekday} aria-hidden>
                  {day}
                </span>
              ))}
              {monthDays(month).map((date, i) =>
                date ? (
                  <button
                    key={date}
                    type="button"
                    data-date={date}
                    aria-label={date}
                    aria-pressed={date === from || date === end}
                    data-endpoint={date === from || date === end}
                    data-in-range={valid && date > from && date < end}
                    onKeyDown={(e) => moveFocus(e, date, index)}
                    onClick={() => choose(date)}
                  >
                    {Number(date.slice(8))}
                  </button>
                ) : (
                  <span key={`empty-${i}`} />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
      {!valid && (
        <p className={styles.error} role="alert">
          เลือกช่วงวันที่ 1–366 วัน โดยวันสิ้นสุดไม่อยู่ก่อนวันเริ่มต้น
        </p>
      )}
      <div className={styles.actions}>
        <Button onClick={onClose}>ยกเลิก</Button>
        <Button
          variant="primary"
          disabled={!valid}
          onClick={() => {
            if (valid) {
              onApply({ from, toExclusive: addDays(end, 1) });
              onClose();
            }
          }}
        >
          ใช้ช่วงวันที่
        </Button>
      </div>
    </dialog>
  );
}
