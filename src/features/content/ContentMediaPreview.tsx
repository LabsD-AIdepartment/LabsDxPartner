'use client';
import { useEffect, useRef, useState } from 'react';
import type { ContentMediaValue } from '@/contracts/content';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import styles from './content.module.css';
export type PreviewMedia = ContentMediaValue;
/** Preview accepts only media projected by the owned content response. It never resolves provider pages. */
export function ContentMediaPreview({
  media,
  title,
  onClose,
}: {
  media: PreviewMedia;
  title: string;
  onClose: () => void;
}) {
  return (
    <Dialog open title={title} onClose={onClose} className={styles.mediaDialog}>
      <MediaAsset key={`${media.kind}:${media.src}`} media={media} title={title} />
    </Dialog>
  );
}
function MediaAsset({ media, title }: { media: PreviewMedia; title: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    // Mobile browsers may defer video metadata until the user presses Play.
    // Keep native controls available; only a media error should remove the video.
    if (state !== 'loading' || media.kind === 'video') return;
    const timeout = setTimeout(() => setState('error'), 15_000);
    return () => clearTimeout(timeout);
  }, [state, attempt, media.kind]);
  const retry = () => {
    setState('loading');
    setAttempt((value) => value + 1);
  };
  return (
    <div className={styles.mediaPreview}>
      {state !== 'error' &&
        (media.kind === 'video' ? (
          <VideoAsset
            key={attempt}
            media={media}
            title={title}
            onReady={() => setState('ready')}
            onError={() => setState('error')}
          />
        ) : (
          <img
            key={attempt}
            className={styles.mediaAsset}
            src={media.src}
            alt={title}
            onLoad={() => setState('ready')}
            onError={() => setState('error')}
          />
        ))}
      {state === 'loading' && (
        <p className={styles.mediaStatus} role="status">
          {media.kind === 'video' ? 'กดเล่นหากวิดีโอยังไม่เริ่ม' : 'กำลังโหลดภาพ…'}
        </p>
      )}
      {state === 'error' && (
        <div className={styles.mediaError} role="alert">
          <p>โหลด{media.kind === 'video' ? 'วิดีโอ' : 'ภาพ'}ไม่สำเร็จ</p>
          <Button onClick={retry}>ลองอีกครั้ง</Button>
        </div>
      )}
    </div>
  );
}

function VideoAsset({
  media,
  title,
  onReady,
  onError,
}: {
  media: Extract<PreviewMedia, { kind: 'video' }>;
  title: string;
  onReady: () => void;
  onError: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [aspectRatio, setAspectRatio] = useState<string>();
  const updateAspectRatio = () => {
    const player = video.current;
    if (player && player.videoWidth > 0 && player.videoHeight > 0) {
      // A poster may have a different shape. Use the actual video track dimensions.
      setAspectRatio(`${player.videoWidth} / ${player.videoHeight}`);
    }
  };
  useEffect(() => {
    const player = video.current;
    // React StrictMode replays setup after cleanup on the same DOM node. The
    // cleanup releases the resource, so setup must restore it even when React
    // has no changed src prop to commit a second time.
    if (player && player.getAttribute('src') !== media.src) {
      player.setAttribute('src', media.src);
      player.load();
    }
    return () => {
      if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
      }
    };
  }, [media.src]);
  return (
    <video
      ref={video}
      className={styles.mediaAsset}
      src={media.src}
      poster={media.poster}
      style={aspectRatio ? { aspectRatio } : undefined}
      controls
      autoPlay
      tabIndex={0}
      playsInline
      preload="metadata"
      aria-label={title}
      onLoadedMetadata={() => {
        updateAspectRatio();
        onReady();
      }}
      onResize={updateAspectRatio}
      onError={onError}
    />
  );
}
