'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PartnerShell } from '@/features/shell/PartnerShell';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { ScopedQueryProvider } from '@/shared/query/provider';
import { Button } from '@/shared/ui/Button';
import { createOverviewTransport } from './overview-transport';
import type { ScenarioName } from './scenarios';
import styles from './access-preview.module.css';
const scope = { userId: 'preview-user', partnerId: 'preview-partner', permissionRevision: '1' };
export function OverviewPreview() {
  const [mode, setMode] = useState<ScenarioName | 'loading' | 'error'>('ready');
  const [paid, setPaid] = useState(false);
  const transport = useMemo(() => createOverviewTransport(mode, paid), [mode, paid]);
  return (
    <>
      <aside className={styles.toolbar} aria-label="ชุดตรวจ Overview">
        <strong>Overview journey preview</strong>
        <span>ข้อมูลจำลอง · ไม่มีข้อมูลพาร์ทเนอร์จริง</span>
        <label>
          สถานการณ์ภาพรวม{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            {[
              'ready',
              'empty',
              'partial',
              'stale',
              'unavailable',
              'adjustments',
              'loading',
              'error',
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <Button onClick={() => setPaid(!paid)}>
          {paid ? 'คืนสถานะก่อนจ่าย' : 'จำลองบันทึกจ่าย 10,000 บาท'}
        </Button>
      </aside>
      <PartnerShell
        active="overview"
        hrefs={{
          overview: '/overview-preview',
          content: '/content',
          transactions: '/transactions',
        }}
        footerNote="ตัวอย่าง Overview · ข้อมูลจำลอง"
      >
        <ScopedQueryProvider key={mode} scope={scope}>
          <OverviewPage
            transport={transport}
            scope={scope}
            brands={['Axtion', 'Tendrix', 'Rusiren', 'Melura', 'Zenova']}
          />
          <RefreshOnPayment paid={paid} />
        </ScopedQueryProvider>
      </PartnerShell>
    </>
  );
}

function RefreshOnPayment({ paid }: { paid: boolean }) {
  const client = useQueryClient();
  const previous = useRef(paid);
  useEffect(() => {
    if (previous.current === paid) return;
    previous.current = paid;
    // Also replace an initial in-flight response, which invalidation alone can reuse.
    let current = true;
    void client.cancelQueries().then(() => {
      if (current) return client.invalidateQueries();
    });
    return () => {
      current = false;
    };
  }, [paid, client]);
  return null;
}
