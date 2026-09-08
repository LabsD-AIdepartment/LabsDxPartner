'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';
import styles from './ui.module.css';

/** Reserves the caller's image geometry when an optional cover cannot load. */
export function CoverImage({
  src,
  alt,
  className = '',
  style,
  loading,
}: {
  src: string | null;
  alt: string;
  className?: string;
  style?: CSSProperties;
  loading?: 'lazy' | 'eager';
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (src && image.current?.complete && !image.current.naturalWidth) setFailed(src);
  }, [src]);
  if (!src || failed === src)
    return (
      <span
        className={`${styles.imageFallback} ${className}`}
        style={style}
        role="img"
        aria-label={`${alt || 'ภาพประกอบ'} — ไม่สามารถโหลดภาพได้`}
      >
        <ImageOff size={24} aria-hidden />
      </span>
    );
  return (
    <img
      ref={image}
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onError={() => setFailed(src)}
    />
  );
}
