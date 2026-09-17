'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { Text } from './Text';
import { useMobileHeaderActions } from './MobileHeaderActions';
import styles from './ui.module.css';
export function Dialog({
  open,
  onClose,
  title,
  children,
  sheet = false,
  density = 'default',
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  sheet?: boolean;
  density?: 'default' | 'compact';
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const placement = useMobileHeaderActions();
  const currentPlacement = useRef(placement);
  currentPlacement.current = placement;
  const id = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) dialog.close();
    return () => {
      if (dialog.open) dialog.close();
      if (open) {
        const profile = currentPlacement.current?.profile;
        if (
          profile &&
          previous?.matches('[data-mobile-header-action]') &&
          (!previous.isConnected || previous.getClientRects().length === 0)
        ) {
          profile.activate();
        } else previous?.focus();
      }
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`${styles.dialog} ${sheet ? styles.sheet : ''} ${density === 'compact' ? styles.dialogCompact : ''} ${className}`}
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const focusable = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const r = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX > r.right ||
            event.clientY < r.top ||
            event.clientY > r.bottom
          )
            close.current();
        }
      }}
    >
      <div className={styles.heading}>
        <Text as="h2" variant="sectionTitle" id={id}>
          {title}
        </Text>
        <Button icon aria-label="ปิดหน้าต่าง" onClick={onClose}>
          <X size={20} />
        </Button>
      </div>
      <div className={styles.dialogBody}>{children}</div>
    </dialog>
  );
}
