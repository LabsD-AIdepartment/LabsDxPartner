'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMobileHeaderActions } from '@/shared/ui/MobileHeaderActions';
import { Bell } from 'lucide-react';
import type { z } from 'zod';
import type { Notifications } from '@/contracts/notifications';
import { Text } from '@/shared/ui/Text';
import { timestamp } from '@/shared/ui/format-date';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { DialogActions } from '@/shared/ui/DialogActions';
import { DataState, type DisplayState } from '@/shared/ui/DataState';
import styles from './shell.module.css';
export function NotificationButton({
  data,
  state = 'ready',
  onSeen,
  onOpenStatement,
  pending = false,
  seenError = false,
  onRetry,
  onLoadMore,
  loadingMore = false,
}: {
  pending?: boolean;
  seenError?: boolean;
  onRetry?: () => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  data: z.infer<typeof Notifications> | null;
  state?: DisplayState;
  onSeen: (id: string) => void;
  onOpenStatement: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = data?.unseenCount ?? 0;
  const placement = useMobileHeaderActions();
  const profile = placement?.mobile ? placement.profile : null;
  return (
    <>
      {profile ? (
        createPortal(
          <Button
            data-mobile-header-action="notifications"
            aria-label={`การแจ้งเตือน${count ? ` ${count} รายการที่ยังไม่อ่าน` : ''}`}
            onClick={() => {
              profile.activate();
              setOpen(true);
            }}
          >
            <Bell size={19} aria-hidden />
            การแจ้งเตือน
          </Button>,
          profile.actions,
        )
      ) : (
        <div className={styles.noticeWrap}>
          <Button
            data-mobile-header-action="notifications"
            icon
            aria-label={`การแจ้งเตือน${count ? ` ${count} รายการที่ยังไม่อ่าน` : ''}`}
            onClick={() => setOpen(true)}
          >
            <Bell size={19} />
          </Button>
          {count > 0 && (
            <span className={styles.count} aria-hidden>
              {count > 99 ? '99+' : count}
            </span>
          )}
        </div>
      )}
      {profile &&
        count > 0 &&
        createPortal(
          <>
            <span className={styles.count} aria-hidden>
              {count > 99 ? '99+' : count}
            </span>
            <span className={styles.unreadDescription}>{count} รายการที่ยังไม่อ่าน</span>
          </>,
          profile.badge,
        )}
      <Dialog density="compact" open={open} onClose={() => setOpen(false)} title="การแจ้งเตือน">
        <DataState
          state={state === 'ready' && data?.items.length === 0 ? 'empty' : state}
          onRetry={onRetry}
        />
        {seenError && <p role="alert">บันทึกสถานะอ่านไม่สำเร็จ กรุณาลองกดอีกครั้ง</p>}
        <div className={styles.notices}>
          {data?.items.map((notice) => (
            <div key={notice.id} className={styles.noticeRow}>
              <div className={styles.noticeContent}>
                <Button
                  className={styles.noticeTitle}
                  onClick={() => {
                    onOpenStatement(notice.statementId);
                    setOpen(false);
                  }}
                >
                  {notice.title}
                </Button>
                <Text variant="caption" tone="muted">
                  {timestamp(notice.createdAt)}
                </Text>
              </div>
              {!notice.seen && (
                <DialogActions>
                  <Button
                    className={styles.noticeAction}
                    disabled={pending}
                    title="ทำเครื่องหมายรายการนี้และรายการก่อนหน้าว่าอ่านแล้ว"
                    onClick={() => onSeen(notice.id)}
                  >
                    อ่านแล้ว
                  </Button>
                </DialogActions>
              )}
            </div>
          ))}
        </div>
        {onLoadMore && (
          <DialogActions>
            <Button disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? 'กำลังโหลด' : 'ดูรายการก่อนหน้า'}
            </Button>
          </DialogActions>
        )}
      </Dialog>
    </>
  );
}
