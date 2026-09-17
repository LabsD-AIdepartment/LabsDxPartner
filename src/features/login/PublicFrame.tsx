import { TextGroup } from '@/shared/ui/TextGroup';
import { ActionArrow } from '@/shared/ui/ActionArrow';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '@/features/shell/ThemeToggle';
import styles from './login.module.css';
import fluid from './fluid-login.module.css';
import { FluidBackdrop } from './FluidBackdrop';
import { BilingualTagline } from './BilingualTagline';
export function PublicFrame({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: 'default' | 'fluid';
}) {
  const isFluid = variant === 'fluid';
  const content = (
    <div className={styles.page}>
      <a className="skip-link" href="#public-main">
        ข้ามไปยังเนื้อหา
      </a>
      <header className={styles.header}>
        <Link href="/login" className={styles.logo}>
          Labs D x Partner
        </Link>
        <ThemeToggle />
      </header>
      <main id="public-main" className={`${styles.main} ${isFluid ? fluid.main : ''}`}>
        <section
          className={`${styles.story} ${isFluid ? fluid.story : ''}`}
          aria-label="พื้นที่สำหรับพาร์ทเนอร์ Labs D"
        >
          {!isFluid && <span className={styles.eyebrow}>A partnership that grows with you</span>}
          <h1>
            Your content
            <br />
            <span>Your impact</span>
          </h1>
          {isFluid ? (
            <BilingualTagline english="A partnership that grows with you" thai="เติบโตไปด้วยกัน" />
          ) : (
            <p>เติบโตไปด้วยกัน</p>
          )}
          {!isFluid && (
            <div className={styles.promise}>
              <span className={styles.promiseIcon}>
                <ActionArrow />
              </span>
              <TextGroup>
                <strong>เห็นภาพรวม เข้าใจทุกรายได้</strong>
                <p>
                  ติดตามผลงาน ตรวจสอบคอมมิชชัน
                  <br />
                  และดูรายละเอียดการจ่ายเงินในที่เดียว
                </p>
              </TextGroup>
            </div>
          )}
        </section>
        <section
          className={`${styles.panel} ${isFluid ? fluid.panel : ''}`}
          aria-label="การเข้าสู่ระบบ"
        >
          {children}
        </section>
      </main>
      <footer className={styles.footer}>
        <span>LABS D × PARTNER / Your creativity, rewarded</span>
        <span>
          <ShieldCheck size={16} aria-hidden /> ระบบสำหรับพาร์ทเนอร์ที่ได้รับเชิญเท่านั้น
        </span>
      </footer>
    </div>
  );
  return isFluid ? (
    <div className={fluid.canvas}>
      <FluidBackdrop />
      {content}
    </div>
  ) : (
    content
  );
}
