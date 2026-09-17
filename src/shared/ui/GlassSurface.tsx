import type { HTMLAttributes } from 'react';
import styles from './glass-surface.module.css';

export function GlassSurface({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.glass} ${className}`} {...props} />;
}
