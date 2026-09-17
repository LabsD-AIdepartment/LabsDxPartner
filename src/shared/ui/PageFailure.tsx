'use client';
import { Button } from './Button';
import { Text } from './Text';
import { errorReference } from './error-reference';
import styles from './page-failure.module.css';

export function PageFailure({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  const reference = errorReference(digest);
  return (
    <main className={styles.page}>
      <section className={styles.panel} role="alert" aria-labelledby="page-failure-title">
        <Text as="h1" variant="sectionTitle" id="page-failure-title">เปิดหน้านี้ไม่สำเร็จ</Text>
        <Text>ลองโหลดหน้าใหม่อีกครั้ง หากยังพบปัญหา ติดต่อผู้ดูแล Labs D</Text>
        {reference && <Text variant="caption" tone="muted">รหัสอ้างอิง {reference}</Text>}
        <Button variant="primary" onClick={onRetry}>โหลดหน้าใหม่</Button>
      </section>
    </main>
  );
}
