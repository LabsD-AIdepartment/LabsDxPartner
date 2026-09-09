import { BadgeCheck } from 'lucide-react';
import { CoverImage } from '@/shared/ui/CoverImage';
import type { PartnerPresentation } from './EarningsSummary';
import styles from './overview.module.css';
export function PartnerIdentity({ partner }: { partner?: PartnerPresentation }) {
  return (
    <div className={styles.portrait}>
      <CoverImage
        src={partner?.portrait ?? null}
        alt={partner ? `ภาพโปรไฟล์ ${partner.name}` : 'ภาพโปรไฟล์พาร์ทเนอร์'}
        loading="eager"
      />
      <div className={styles.identity}>
        <CoverImage src={partner?.avatar ?? null} alt="" />
        <div>
          <strong>{partner?.name ?? 'พาร์ทเนอร์'}</strong>
          <span>{partner?.role ?? 'Partner'}</span>
        </div>
        <BadgeCheck size={19} aria-hidden />
      </div>
    </div>
  );
}
