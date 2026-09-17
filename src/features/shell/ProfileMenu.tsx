'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useMobileHeaderActions } from '@/shared/ui/MobileHeaderActions';
import { LogOut, UserRound } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { LinkButton } from '@/shared/ui/LinkButton';
import styles from './profile-menu.module.css';

export function ProfileMenu({
  accountHref = '/account',
  avatar,
  onLogout,
  busy = false,
  children,
}: {
  accountHref?: string;
  avatar?: string;
  onLogout?: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const placement = useMobileHeaderActions();
  const setProfile = placement?.setProfile;
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const [badgeTarget, setBadgeTarget] = useState<HTMLSpanElement | null>(null);
  const activate = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  const id = useId();
  const badgeId = useId();
  useEffect(() => {
    if (!setProfile || !actionsTarget || !badgeTarget) return;
    setProfile({ actions: actionsTarget, badge: badgeTarget, activate });
    return () => setProfile(null);
  }, [setProfile, actionsTarget, badgeTarget, activate]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Button
        ref={trigger}
        className={styles.trigger}
        icon
        aria-label="เมนูโปรไฟล์"
        aria-describedby={placement?.mobile ? badgeId : undefined}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {avatar ? (
          <img className={styles.avatar} src={avatar} alt="" />
        ) : (
          <UserRound size={18} aria-hidden />
        )}
        <span id={badgeId} className={styles.badgeTarget} ref={setBadgeTarget} />
      </Button>
      <div hidden={!open} id={id} className={styles.panel} role="region" aria-label="โปรไฟล์">
        <LinkButton href={accountHref}>
          <UserRound size={18} aria-hidden />
          จัดการบัญชี
        </LinkButton>
        <div className={styles.mobileActions} ref={setActionsTarget} />
        {open && children}
        {open && onLogout && (
          <Button disabled={busy} onClick={onLogout}>
            <LogOut size={18} aria-hidden />
            {busy ? 'กำลังออกจากระบบ…' : 'ออกจากระบบ'}
          </Button>
        )}
      </div>
    </div>
  );
}
