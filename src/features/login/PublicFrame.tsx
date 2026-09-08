import type { ReactNode } from 'react';
import Link from 'next/link';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import { ThemeToggle } from '@/features/shell/ThemeToggle';
import styles from './login.module.css';
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
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
      <main id="public-main" className={styles.main}>
        <section className={styles.story} aria-label="พื้นที่สำหรับพาร์ทเนอร์ Labs D">
          <span className={styles.eyebrow}>A partnership that grows with you</span>
          <h1>
            Your content
            <br />
            <span>Your impact</span>
          </h1>
          <p>
            ทุกผลงานมีคุณค่า
            <br />
            เติบโตไปด้วยกันกับ Labs D
          </p>
          <div className={styles.promise}>
            <ArrowUpRight aria-hidden size={28} />
            <div>
              <strong>เห็นภาพรวม เข้าใจทุกรายได้</strong>
              <p>
                ติดตามผลงาน ตรวจสอบคอมมิชชัน
                <br />
                และดูรายละเอียดการจ่ายเงินในที่เดียว
              </p>
            </div>
          </div>
        </section>
        <section className={styles.panel} aria-label="การเข้าสู่ระบบ">
          {children}
        </section>
      </main>
      <footer className={styles.footer}>
        <span>LABS D × PARTNER / Your creativity, rewarded</span>
        <span>
          <ShieldCheck size={16} aria-hidden /> พื้นที่ส่วนตัวสำหรับพาร์ทเนอร์ที่ได้รับเชิญ
        </span>
      </footer>
    </div>
  );
}
