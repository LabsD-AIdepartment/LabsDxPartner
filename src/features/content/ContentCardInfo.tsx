import { TextGroup } from '@/shared/ui/TextGroup';
import type { z } from 'zod';
import type { ContentCard as CardContract } from '@/contracts/content';
import { platformLabels } from '@/contracts/platform-capabilities';
import { dateLabel } from '@/shared/ui/format-date';
import styles from './content.module.css';

type CardInfo = Pick<
  z.infer<typeof CardContract>,
  'title' | 'removed' | 'adReferences' | 'publishedAt'
>;

export function ContentCardInfo({ clip }: { clip: CardInfo }) {
  return (
    <TextGroup className={styles.cardInfo}>
      <strong title={clip.removed ? 'คลิปถูกนำออกแล้ว' : clip.title}>
        {clip.removed ? 'คลิปถูกนำออกแล้ว' : clip.title}
      </strong>
      <span className={styles.adReferences}>
        {clip.adReferences == null
          ? 'Ads ID —'
          : clip.adReferences.length === 0
            ? 'ยังไม่มี Ads ID'
            : clip.adReferences.map((ad) => (
                <span key={`${ad.platform}:${ad.externalId}`}>
                  <span>{platformLabels[ad.platform]}</span>
                  <span>
                    Ads ID: <span className={styles.adId}>{ad.externalId}</span>
                  </span>
                </span>
              ))}
      </span>
      {clip.removed && <span className={styles.removed}>เก็บประวัติรายได้ไว้ให้ตรวจสอบ</span>}
      <span className={styles.meta}>{dateLabel(clip.publishedAt)}</span>
    </TextGroup>
  );
}
