import type { ReactNode } from 'react';
import { ThemeToggle } from '@/features/shell/ThemeToggle';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Text } from '@/shared/ui/Text';
import type { OpsView } from './model';
import styles from './operations.module.css';
export function StaffShell({
  view,
  basePath = '/ops',
  children,
  routes,
}: {
  view: OpsView;
  routes?: Partial<Record<OpsView, string>>;
  basePath?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#main-content">
        ข้ามไปยังเนื้อหา
      </a>
      <header className={styles.header}>
        <Text as="strong" variant="sectionTitle">
          Labs D · เจ้าหน้าที่
        </Text>
        <ThemeToggle />
      </header>
      <nav aria-label="เมนูเจ้าหน้าที่" className={styles.nav}>
        {(
          [
            ['partners', 'พาร์ทเนอร์'],
            ['imports', 'ข้อมูลนำเข้า'],
            ['periods', 'งวดและการชำระ'],
          ] as const
        )
          .filter(([key]) => !routes || !!routes[key])
          .map(([key, label]) => (
            <LinkButton
              key={key}
              href={routes?.[key] ?? `${basePath}/${key}`}
              aria-current={view === key ? 'page' : undefined}
              variant={view === key ? 'primary' : 'secondary'}
            >
              {label}
            </LinkButton>
          ))}
      </nav>
      <main id="main-content">
        <Text as="h1" variant="sectionTitle">
          {
            {
              partners: 'พาร์ทเนอร์และข้อตกลง',
              imports: 'ตรวจสอบข้อมูลนำเข้า',
              periods: 'งวดและการชำระ',
            }[view]
          }
        </Text>
        {children}
      </main>
    </div>
  );
}
