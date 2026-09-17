'use client';
import { PreviewTools } from './PreviewTools';
import { createPreviewVideoRegistration } from './shop-video-transport';
import { ShopVideoRegistration } from '@/features/shop-video/ShopVideoRegistration';
import { useMemo, useState } from 'react';
import { StaffShell } from '@/features/operations/StaffShell';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { AdRegistrationConsole } from '@/features/marketing-ads/AdRegistrationConsole';
import { ConnectionsPanel } from '@/features/marketing-ads/ConnectionsPanel';
import {
  createAdRegistrationTransport,
  lookupModes,
  marketingScope,
  type LookupMode,
} from './ad-registration-transport';
import styles from './access-preview.module.css';
export function AdRegistrationPreview({ initialTargetId }: { initialTargetId?: string }) {
  const adapter = useMemo(() => {
    const value = createAdRegistrationTransport();
    value.setRollout('facebook-first');
    return value;
  }, []);
  const videoTransport = useMemo(createPreviewVideoRegistration, []);
  const [rollout, setRollout] = useState<'all' | 'facebook-first' | 'off'>('facebook-first');
  const [mode, setMode] = useState<LookupMode>('ready');
  const [failed, setFailed] = useState(false);
  return (
    <>
      <PreviewTools toolbar>
        <aside className={styles.toolbar} aria-label="ชุดตรวจการเชื่อมแอด">
          <strong>Marketing ads preview</strong>
          <span>ข้อมูลจำลอง · ยังไม่เชื่อม API จริง · รีโหลดแล้วเริ่มใหม่</span>
          <label>
            ความพร้อมจำลอง{' '}
            <select
              value={rollout}
              onChange={(event) => {
                const value = event.target.value as typeof rollout;
                adapter.setRollout(value);
                setRollout(value);
              }}
            >
              <option value="facebook-first">Facebook ก่อน</option>
              <option value="all">ทุกแพลตฟอร์มจำลอง</option>
              <option value="off">ปิดทั้งหมด</option>
            </select>
          </label>
          <label>
            ผลการค้นหาจำลอง{' '}
            <select
              value={mode}
              onChange={(event) => {
                const value = event.target.value as LookupMode;
                adapter.setMode(value);
                setMode(value);
              }}
            >
              {lookupModes.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={failed}
              onChange={(event) => {
                adapter.setSyncFailure(event.target.checked);
                setFailed(event.target.checked);
              }}
            />
            จำลองปัญหาการเชื่อมต่อหลังบันทึก
          </label>
        </aside>
      </PreviewTools>
      <StaffShell view="ads" basePath="/ops-preview">
        <IsolatedQueryProvider
          identity={['marketing', marketingScope.actorId, marketingScope.permissionRevision]}
        >
          <AdRegistrationConsole
            scope={marketingScope}
            transport={adapter.transport}
            initialTargetId={initialTargetId}
          />
          <ShopVideoRegistration scope={marketingScope} transport={videoTransport} />
          <ConnectionsPanel
            scope={marketingScope}
            transport={videoTransport.connectionTransport}
            platform="tiktok"
          />
          <ConnectionsPanel scope={marketingScope} transport={adapter.connectionTransport} />
        </IsolatedQueryProvider>
      </StaffShell>
    </>
  );
}
