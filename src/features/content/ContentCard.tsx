'use client';
import { useState } from 'react';
import { Expand, Play } from 'lucide-react';
import { ContentMediaPreview } from './ContentMediaPreview';
import { ContentCardInfo } from './ContentCardInfo';
import Link from '@/shared/ui/AppLink';
import type { z } from 'zod';
import type { ContentCard as CardContract } from '@/contracts/content';
import { CoverImage } from '@/shared/ui/CoverImage';
import { Money } from '@/shared/ui/Money';
import styles from './content.module.css';
export function ContentCard({ clip, href }: { clip: z.infer<typeof CardContract>; href: string }) {
  const [open, setOpen] = useState(false);
  const media = clip.removed
    ? null
    : (clip.media ?? (clip.cover ? { kind: 'image' as const, src: clip.cover } : null));
  const mediaLabel = media?.kind === 'video' ? 'ดูวิดีโอ' : 'ขยายภาพ';
  return (
    <article className={styles.clipCard}>
      <button
        type="button"
        className={styles.coverWrap}
        aria-label={`${mediaLabel} ${clip.title}`}
        disabled={!media}
        onClick={() => setOpen(true)}
      >
        <CoverImage
          className={styles.cover}
          src={clip.removed ? null : clip.cover}
          alt={clip.removed ? 'คลิปถูกนำออกแล้ว' : clip.title}
          loading="lazy"
          style={{ objectPosition: clip.coverPosition }}
        />
        <span className={styles.brand}>{clip.brand}</span>
        {media && (
          <span className={styles.mediaHint} aria-hidden>
            ดูคลิป
          </span>
        )}
        {media && (
          <span className={styles.mediaIndicator} aria-hidden>
            {media.kind === 'video' ? <Play size={18} /> : <Expand size={18} />}
          </span>
        )}
      </button>
      <Link className={styles.clipDetails} href={href}>
        <ContentCardInfo clip={clip} />
        <div className={styles.earned}>
          <span>คอมมิชชันยืนยันแล้ว</span>
          <Money value={clip.earned} reason={clip.unavailableReason ?? undefined} />
        </div>
        {clip.earned === null && <span className={styles.meta}>{clip.unavailableReason}</span>}
      </Link>
      {open && media && (
        <ContentMediaPreview media={media} title={clip.title} onClose={() => setOpen(false)} />
      )}
    </article>
  );
}
