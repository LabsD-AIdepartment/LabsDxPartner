import Link from 'next/link';
import type { z } from 'zod';
import type { ContentCard as CardContract } from '@/contracts/content';
import { CoverImage } from '@/shared/ui/CoverImage';
import { Money } from '@/shared/ui/Money';
import { dateLabel } from '@/shared/ui/format-date';
import styles from './content.module.css';
export function ContentCard({ clip, href }: { clip: z.infer<typeof CardContract>; href: string }) {
  return (
    <Link className={styles.clipCard} href={href}>
      <div className={styles.coverWrap}>
        <CoverImage
          className={styles.cover}
          src={clip.removed ? null : clip.cover}
          alt={clip.removed ? 'คลิปถูกนำออกแล้ว' : clip.title}
          loading="lazy"
          style={{ objectPosition: clip.coverPosition }}
        />
        <span className={styles.brand}>{clip.brand}</span>
      </div>
      <strong>{clip.removed ? 'คลิปถูกนำออกแล้ว' : clip.title}</strong>
      {clip.removed && <span className={styles.removed}>เก็บประวัติรายได้ไว้ให้ตรวจสอบ</span>}
      <span className={styles.meta}>
        {dateLabel(clip.publishedAt)} ·{' '}
        {clip.views === null
          ? 'ยังไม่มียอดดู'
          : `${new Intl.NumberFormat('th-TH').format(clip.views)} views`}
      </span>
      <div className={styles.earned}>
        <span>คอมมิชชันในช่วงนี้</span>
        <Money value={clip.earned} reason={clip.unavailableReason ?? undefined} />
      </div>
      {clip.earned === null && <span className={styles.meta}>{clip.unavailableReason}</span>}
    </Link>
  );
}
