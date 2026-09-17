'use client';
import { PreviewTools } from './PreviewTools';
import { useMemo, useState } from 'react';
import { OperationsPage } from '@/features/operations/OperationsPage';
import { StaffShell } from '@/features/operations/StaffShell';
import type { OpsView } from '@/features/operations/model';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { opsScope, opsModes, createOpsTransport, type OpsMode } from './operations-transport';
import styles from './access-preview.module.css';
import { StaffWithdrawalPreview } from './StaffWithdrawalPreview';
export function OperationsPreview({
  view = 'partners',
  search = '',
}: {
  view?: OpsView | 'requests';
  search?: string;
}) {
  if (
    view === 'requests' ||
    (view === 'periods' && new URLSearchParams(search).get('view') === 'withdrawals')
  )
    return <StaffWithdrawalPreview view={view} search={search} />;
  return <LegacyOperationsPreview view={view} />;
}
function LegacyOperationsPreview({ view }: { view: OpsView }) {
  const [mode, setMode] = useState<OpsMode>('ready');
  const transport = useMemo(() => createOpsTransport(mode), [mode]);
  return (
    <>
      <PreviewTools toolbar>
        <aside className={styles.toolbar}>
          <strong>Operations journey preview</strong>
          <span>พื้นที่เจ้าหน้าที่จำลอง · ไม่มีการบันทึกหรือส่งข้อมูลจริง</span>
          <label>
            สถานการณ์เจ้าหน้าที่{' '}
            <select value={mode} onChange={(e) => setMode(e.target.value as OpsMode)}>
              {opsModes.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </aside>
      </PreviewTools>
      <StaffShell view={view} basePath="/ops-preview">
        <IsolatedQueryProvider
          key={mode}
          identity={['ops', opsScope.actorId, opsScope.permissionRevision]}
        >
          <OperationsPage view={view} scope={opsScope} transport={transport} />
        </IsolatedQueryProvider>
      </StaffShell>
    </>
  );
}
