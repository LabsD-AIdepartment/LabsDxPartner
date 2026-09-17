import type { ReactNode } from 'react';
import { ThemeToggle } from '@/features/shell/ThemeToggle';
import { LinkButton } from '@/shared/ui/LinkButton';
import { Text } from '@/shared/ui/Text';
import type { OpsView } from './model';
import styles from './operations.module.css';
type StaffView = OpsView | 'ads' | 'requests';
/** Real staff routes differ from the generic fixture workspace routes. */
export function nativeStaffRoutes(marketingEnabled: boolean) {
  return {
    partners: '/ops/access',
    ...(marketingEnabled ? { ads: '/ops/ads' } : {}),
    periods: '/ops/periods',
  };
}
export function StaffShell({
  view,
  basePath = '/ops',
  children,
  routes,
}: {
  view: StaffView;
  routes?: Partial<Record<StaffView, string>>;
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
            ['ads', 'แอดและการเชื่อมต่อ'],
            ['imports', 'ข้อมูลนำเข้า'],
            ['periods', 'งวดและการชำระ'],
            ['requests', 'คำขอถอนเงิน'],
          ] as const
        )
          .filter(([key]) => (key === 'requests' ? !!routes?.requests : !routes || !!routes[key]))
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
              ads: 'แอดและการเชื่อมต่อ',
              imports: 'ตรวจสอบข้อมูลนำเข้า',
              periods: 'งวดและการชำระ',
              requests: 'คำขอถอนเงินของพาร์ตเนอร์',
            }[view]
          }
        </Text>
        {children}
      </main>
    </div>
  );
}
