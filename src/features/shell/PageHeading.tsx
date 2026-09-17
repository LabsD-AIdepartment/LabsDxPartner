import type { ReactNode, Ref } from 'react';
import { Text } from '@/shared/ui/Text';
import styles from './shell.module.css';

export type PageHeadingVisibility = {
  mobile: boolean;
  tablet: boolean;
  desktop: boolean;
};
export const DEFAULT_PAGE_HEADING_VISIBILITY: Readonly<PageHeadingVisibility> = Object.freeze({
  mobile: false,
  tablet: true,
  desktop: true,
});

/** Responsive presentation only; the action surface stays mounted in every mode. */
export function PageHeading({
  title,
  accent,
  subtitle,
  visibility,
  actions,
  actionsRef,
}: {
  title: string;
  accent: string;
  subtitle?: string;
  visibility?: Partial<PageHeadingVisibility>;
  actions?: ReactNode;
  actionsRef?: Ref<HTMLDivElement>;
}) {
  const modes = {
    mobile: visibility?.mobile ?? DEFAULT_PAGE_HEADING_VISIBILITY.mobile,
    tablet: visibility?.tablet ?? DEFAULT_PAGE_HEADING_VISIBILITY.tablet,
    desktop: visibility?.desktop ?? DEFAULT_PAGE_HEADING_VISIBILITY.desktop,
  };
  return (
    <div
      className={styles.pageHeading}
      data-mobile-visible={modes.mobile}
      data-tablet-visible={modes.tablet}
      data-desktop-visible={modes.desktop}
    >
      <div className={styles.titleRow}>
        <h1 className={styles.title}>
          {title} <span>{accent}</span>
        </h1>
        <div ref={actionsRef} className={styles.titleActions}>
          {actions}
        </div>
      </div>
      {subtitle && (
        <Text tone="muted" className={styles.subtitle}>
          {subtitle}
        </Text>
      )}
    </div>
  );
}
