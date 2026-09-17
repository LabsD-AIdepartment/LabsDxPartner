import Link from '@/shared/ui/AppLink';
import type { ComponentProps } from 'react';
import styles from './ui.module.css';
export function LinkButton({
  variant = 'secondary',
  icon = false,
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: 'primary' | 'secondary'; icon?: boolean }) {
  return (
    <Link
      className={[
        styles.button,
        variant === 'primary' ? styles.primary : '',
        icon ? styles.icon : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}
