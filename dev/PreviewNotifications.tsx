'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { readyScenario } from './scenarios/ready';
import type { NotificationPreferencesValue } from '@/contracts/account-settings';
import { noticeAllowed } from '@/features/account/settings-model';

/** Existing synthetic period notices; independent of withdrawal outcomes and DEV controls. */
export function PreviewNotifications({
  statementHref,
  preferences,
  state = 'ready',
}: {
  statementHref: (id: string) => string;
  preferences?: NotificationPreferencesValue;
  state?: 'ready' | 'loading' | 'error';
}) {
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const router = useRouter();
  return (
    <NotificationButton
      state={state}
      data={
        state !== 'ready'
          ? null
          : preferences && !noticeAllowed('releases', preferences)
            ? { ...notices, items: [], unseenCount: 0 }
            : notices
      }
      onSeen={(id) =>
        setNotices((current) => {
          const items = current.items.map((item) =>
            item.id === id ? { ...item, seen: true } : item,
          );
          return { ...current, items, unseenCount: items.filter((item) => !item.seen).length };
        })
      }
      onOpenStatement={(id) => router.push(statementHref(id))}
    />
  );
}
