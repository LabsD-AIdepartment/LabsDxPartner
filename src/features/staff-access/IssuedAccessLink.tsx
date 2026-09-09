'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/shared/ui/Card';
import { Field } from '@/shared/ui/Field';
import { Button } from '@/shared/ui/Button';
import { Text } from '@/shared/ui/Text';
import { timestamp } from '@/shared/ui/format-date';
import forms from '@/shared/ui/forms.module.css';
export type IssuedLink = {
  path: '/invite' | '/reset-password';
  token: string;
  recipient: string;
  expiresAt: string;
};
/** Ephemeral result only: never put bearer in query caches, browser storage or the current URL. */
export function IssuedAccessLink({ value, onClose }: { value: IssuedLink; onClose: () => void }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const hide = () => {
      if (document.hidden) onClose();
    };
    const expiry = setTimeout(onClose, Math.max(0, Date.parse(value.expiresAt) - Date.now()));
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(expiry);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [onClose, value.expiresAt]);
  const url = new URL(value.path, window.location.origin);
  url.hash = new URLSearchParams({ token: value.token }).toString();
  return (
    <Card title={`ลิงก์สำหรับ ${value.recipient}`}>
      <Text>
        ส่งให้ผู้รับผ่านช่องทางที่ตรวจสอบแล้วเท่านั้น หมดอายุ {timestamp(value.expiresAt)}
      </Text>
      <Text tone="muted">
        ลิงก์แสดงเฉพาะครั้งนี้ เมื่อปิดหน้าหรือสลับออกจากหน้านี้แล้วต้องออกลิงก์ใหม่หากไม่ได้เก็บไว้
      </Text>
      <Field label="ลิงก์ที่สร้าง" value={url.href} readOnly autoComplete="off" />
      <div className={forms.actions}>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url.href);
              setMessage('คัดลอกลิงก์แล้ว');
            } catch {
              setMessage('คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกลิงก์แล้วคัดลอกด้วยตัวเอง');
            }
          }}
        >
          คัดลอกลิงก์
        </Button>
        <Button onClick={onClose}>ปิดลิงก์</Button>
      </div>
      {message && <Text role="status">{message}</Text>}
    </Card>
  );
}
