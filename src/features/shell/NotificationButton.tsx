'use client';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import type { z } from 'zod';
import type { Notifications } from '@/contracts/notifications';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { DataState, type DisplayState } from '@/shared/ui/DataState';
import styles from './shell.module.css';
export function NotificationButton({
  data,
  state = 'ready',
  onSeen,
  onOpenStatement,
}: {
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
        <DataState state={state === 'ready' && data?.items.length === 0 ? 'empty' : state} />
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
              {!notice.seen && <Button onClick={() => onSeen(notice.id)}>อ่านแล้ว</Button>}
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}
