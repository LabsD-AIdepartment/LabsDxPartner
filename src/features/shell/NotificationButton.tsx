'use client';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import type { z } from 'zod';
import type { Notifications } from '@/contracts/notifications';
import { Text } from '@/shared/ui/Text';
import { timestamp } from '@/shared/ui/format-date';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
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
  return (
    <>
      <div className={styles.noticeWrap}>
        <Button
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
      <Dialog open={open} onClose={() => setOpen(false)} title="การแจ้งเตือน">
        <DataState
          state={state === 'ready' && data?.items.length === 0 ? 'empty' : state}
          onRetry={onRetry}
        />
        {seenError && <p role="alert">บันทึกสถานะอ่านไม่สำเร็จ กรุณาลองกดอีกครั้ง</p>}
        <div className={styles.notices}>
          {data?.items.map((notice) => (
            <div key={notice.id}>
              <Button
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
              {!notice.seen && (
                <Button
                  disabled={pending}
                  title="ทำเครื่องหมายรายการนี้และรายการก่อนหน้าว่าอ่านแล้ว"
                  onClick={() => onSeen(notice.id)}
                >
                  อ่านแล้ว
                </Button>
              )}
            </div>
          ))}
        </div>
        {onLoadMore && (
          <Button disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'กำลังโหลด' : 'ดูรายการก่อนหน้า'}
          </Button>
        )}
      </Dialog>
    </>
  );
}
