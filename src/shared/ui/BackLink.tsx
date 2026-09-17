import type { ComponentProps } from 'react';
import { LinkButton } from './LinkButton';
import styles from './back-link.module.css';

/** Presentation only: callers retain ownership of the explicit return URL. */
export function BackLink({
  label,
  mobileOnly = false,
  compactOnMobile = false,
  className = '',
  ...props
}: Omit<ComponentProps<typeof LinkButton>, 'children' | 'aria-label' | 'icon'> & {
  label: string;
  mobileOnly?: boolean;
  compactOnMobile?: boolean;
}) {
  return (
    <LinkButton
      {...props}
      aria-label={label}
      className={`${styles.link} ${mobileOnly ? styles.mobileOnly : ''} ${mobileOnly || compactOnMobile ? styles.compact : ''} ${className}`}
    >
      <span aria-hidden="true">←</span>
      <span className={styles.label}>{label}</span>
    </LinkButton>
  );
}
