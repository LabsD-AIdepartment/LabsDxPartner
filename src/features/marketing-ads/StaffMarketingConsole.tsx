'use client';
import { ShopVideoRegistration } from '@/features/shop-video/ShopVideoRegistration';
import { nativeVideoRegistration } from '@/features/shop-video/transport';
import { useEffect, useState } from 'react';
import type { StaffAccessSessionValue } from '@/contracts/staff-access';
import { StaffShell, nativeStaffRoutes } from '@/features/operations/StaffShell';
import { IsolatedQueryProvider } from '@/shared/query/provider';
import { LinkButton } from '@/shared/ui/LinkButton';
import { DataState } from '@/shared/ui/DataState';
import { AdRegistrationConsole } from './AdRegistrationConsole';
import { createNativeAdTransport } from './http';
import { TargetSetup } from './TargetSetup';
import {
  ConnectionsPanel,
  nativeConnectionTransport,
  nativeVideoConnectionTransport,
} from './ConnectionsPanel';
import forms from '@/shared/ui/forms.module.css';
export function StaffMarketingConsole({
  session,
  shopVideoEnabled = false,
}: {
  session: StaffAccessSessionValue;
  shopVideoEnabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [transport] = useState(createNativeAdTransport);
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    change();
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return (
    <StaffShell view="ads" routes={nativeStaffRoutes(true)}>
      <div className={forms.actions}>
        <LinkButton href="/account">บัญชีของคุณ / ออกจากระบบ</LinkButton>
        <LinkButton href="/login?next=%2Fops%2Fads">ยืนยันตัวตนเจ้าหน้าที่อีกครั้ง</LinkButton>
      </div>
      {visible ? (
        <IsolatedQueryProvider identity={['staff-marketing', session.userId, session.revision]}>
          <TargetSetup scope={{ actorId: session.userId, permissionRevision: session.revision }} />
          <ConnectionsPanel
            scope={{ actorId: session.userId, permissionRevision: session.revision }}
            transport={nativeConnectionTransport}
          />
          {shopVideoEnabled && (
            <>
              <ConnectionsPanel
                platform="tiktok"
                scope={{ actorId: session.userId, permissionRevision: session.revision }}
                transport={nativeVideoConnectionTransport}
              />
              <ShopVideoRegistration
                scope={{ actorId: session.userId, permissionRevision: session.revision }}
                transport={nativeVideoRegistration}
              />
            </>
          )}
          <AdRegistrationConsole
            scope={{ actorId: session.userId, permissionRevision: session.revision }}
            transport={transport}
          />
        </IsolatedQueryProvider>
      ) : (
        <DataState state="loading" />
      )}
    </StaffShell>
  );
}
