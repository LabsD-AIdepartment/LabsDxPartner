'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { NotificationButton } from '@/features/shell/NotificationButton';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { StatementList } from '@/features/transactions/StatementList';
import { StatementDetail } from '@/features/transactions/StatementDetail';
import { safeTransactionReturn, transactionHref } from '@/features/transactions/model';
import { Button } from '@/shared/ui/Button';
import {
  createTransactionTransport,
  createSampleDocuments,
  type TransactionMode,
  type DocumentMode,
} from './transaction-transport';
import { usePreviewPayment } from './preview-payment';
import { readyScenario } from './scenarios/ready';
import styles from './access-preview.module.css';
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
export function TransactionsPreview({
  segments = [],
  search = '',
}: {
  segments?: string[];
  search?: string;
}) {
  const [mode, setMode] = useState<TransactionMode>('ready'),
    [documentMode, setDocumentMode] = useState<DocumentMode>('ready');
  const [paid, setPaid] = usePreviewPayment();
  const router = useRouter();
  const [notices, setNotices] = useState(() => readyScenario().notifications);
  const transport = useMemo(() => createTransactionTransport(mode, paid), [mode, paid]);
  const documents = useMemo(
    () => createSampleDocuments(mode, paid, documentMode),
    [mode, paid, documentMode],
  );
  const returnTo = safeTransactionReturn(new URLSearchParams(search).get('returnTo'), true);
  const props = { scope, transport, documents, basePath: '/transactions-preview', returnTo };
  return (
    <>
      <aside className={styles.toolbar} aria-label="ชุดตรวจรอบจ่าย">
        <strong>Transactions journey preview</strong>
        <span>ข้อมูลและไฟล์ตัวอย่าง · ไม่ใช่เอกสารจริง</span>
        <label>
          สถานการณ์รอบจ่าย{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as TransactionMode)}>
            {[
              'ready',
              'empty',
              'pending',
              'paid',
              'credit',
              'adjustments',
              'partial',
              'stale',
              'unavailable',
              'loading',
              'error',
              'forbidden',
              'not-found',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          สถานะดาวน์โหลด{' '}
          <select
            value={documentMode}
            onChange={(e) => setDocumentMode(e.target.value as DocumentMode)}
          >
            {['ready', 'pending', 'error', 'forbidden', 'expired'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <Button onClick={() => setPaid(!paid)}>
          {paid ? 'คืนสถานะก่อนจ่าย' : 'จำลองบันทึกจ่าย 10,000 บาท'}
        </Button>
      </aside>
      <PartnerShell
        accountHref="/account-preview"
        active="transactions"
        avatar="/media/celebrity-avatar.png"
        hrefs={{
          overview: returnTo.startsWith('/overview-preview') ? returnTo : '/overview-preview',
          content: '/content-preview',
          transactions: '/transactions-preview',
        }}
        footerNote="ตัวอย่างรอบจ่าย · ข้อมูลจำลอง"
        notifications={
          <NotificationButton
            data={notices}
            onSeen={(id) =>
              setNotices((old) => {
                const items = old.items.map((item) =>
                  item.id === id ? { ...item, seen: true } : item,
                );
                return { ...old, items, unseenCount: items.filter((item) => !item.seen).length };
              })
            }
            onOpenStatement={(id) =>
              router.push(transactionHref('/transactions-preview', id, returnTo))
            }
          />
        }
      >
        <ScopedQueryProvider key={`${mode}:${paid}:${documentMode}`} scope={scope}>
          {segments[0] ? (
            <StatementDetail key={segments[0]} {...props} statementId={segments[0]} />
          ) : (
            <StatementList {...props} />
          )}
        </ScopedQueryProvider>
      </PartnerShell>
    </>
  );
}
