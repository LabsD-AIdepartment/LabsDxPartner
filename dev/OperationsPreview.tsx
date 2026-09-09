'use client';
import { useMemo, useState } from 'react';
import { OperationsPage } from '@/features/operations/OperationsPage';
import { StaffShell } from '@/features/operations/StaffShell';
import type { OpsView } from '@/features/operations/model';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { opsScope, opsModes, createOpsTransport, type OpsMode } from './operations-transport';
import styles from './access-preview.module.css';
export function OperationsPreview({ view = 'partners' }: { view?: OpsView }) {
  const [mode, setMode] = useState<OpsMode>('ready');
  const transport = useMemo(() => createOpsTransport(mode), [mode]);
  return (
    <>
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
