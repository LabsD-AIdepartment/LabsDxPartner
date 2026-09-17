import { TextGroup } from '@/shared/ui/TextGroup';
import { BadgeCheck } from 'lucide-react';
import { CoverImage } from '@/shared/ui/CoverImage';
import { GlassSurface } from '@/shared/ui/GlassSurface';
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
      <GlassSurface className={styles.identity}>
        <CoverImage src={partner?.avatar ?? null} alt="" />
        <TextGroup spacing="tight">
          <strong>{partner?.name ?? 'พาร์ทเนอร์'}</strong>
          <span>{partner?.role ?? 'Partner'}</span>
        </TextGroup>
        <BadgeCheck size={19} aria-hidden />
      </GlassSurface>
    </div>
  );
}
