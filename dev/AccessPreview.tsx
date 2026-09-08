'use client';
import { useState } from 'react';
import { PublicFrame } from '@/features/login/PublicFrame';
import { LoginPage } from '@/features/login/LoginPage';
import { AccessPage } from '@/features/login/AccessPage';
import { accessReasons, type AccessReason } from '@/features/login/access';
import { PartnerShell } from '@/features/shell/PartnerShell';
import type { Menu } from '@/features/shell/Navigation';
import { Card } from '@/shared/ui/Card';
import { Button } from '@/shared/ui/Button';
import styles from './access-preview.module.css';
type PreviewState = AccessReason | 'login' | 'active';
export function AccessPreview({
  active,
  initialActive = false,
}: {
  active: Menu;
  initialActive?: boolean;
}) {
  const [state, setState] = useState<PreviewState>(initialActive ? 'active' : 'login');
  return (
    <>
      <aside className={styles.toolbar} aria-label="ชุดตรวจการเข้าถึง">
        <strong>Access journey preview</strong>
        <span>ข้อมูลจำลอง · ไม่สร้างบัญชีหรือสิทธิ์จริง</span>
        <label>
          สถานะตัวอย่าง{' '}
          <select value={state} onChange={(event) => setState(event.target.value as PreviewState)}>
            <option value="login">login</option>
            {accessReasons.map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
            <option value="active">active</option>
          </select>
        </label>
        {state === 'pending' && (
          <Button onClick={() => setState('active')}>จำลองอนุมัติสิทธิ์</Button>
        )}
      </aside>
      {state === 'active' ? (
        <PartnerShell
          active={active}
          hrefs={{
            overview: '/access-preview?screen=overview&state=active',
            content: '/access-preview?screen=content&state=active',
            transactions: '/access-preview?screen=transactions&state=active',
          }}
          footerNote="ตัวอย่างโครงหน้า · ยังไม่มีข้อมูลพาร์ทเนอร์จริง"
        >
          <div className={styles.content}>
            <Card
              title="พื้นที่ของคุณพร้อมสำหรับขั้นตอนถัดไป"
              description="ตัวอย่างโครงหน้า เมนู และสถานะการเข้าถึงเท่านั้น หน้าข้อมูลจะเพิ่มใน F04–F07"
            >
              <p>ไม่มีข้อมูลยอดขายหรือคอมมิชชันในตัวอย่างนี้</p>
              <Button onClick={() => setState('login')}>ออกจากตัวอย่าง</Button>
            </Card>
          </div>
        </PartnerShell>
      ) : (
        <PublicFrame>
          {state === 'login' ? (
            <LoginPage next="/overview" onPreview={setState} />
          ) : (
            <AccessPage reason={state} next="/overview" onRetry={() => setState('login')} />
          )}
        </PublicFrame>
      )}
    </>
  );
}
