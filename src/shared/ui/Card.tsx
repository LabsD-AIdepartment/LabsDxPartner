import type { ReactNode, HTMLAttributes } from 'react';
import { Text } from './Text';
import { TextGroup } from './TextGroup';
import styles from './ui.module.css';
export function Card({
  title,
  description,
  action,
  children,
  className = '',
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <article className={`${styles.card} ${className}`} {...props}>
      {title && (
        <div className={styles.heading}>
          <TextGroup>
            <Text as="h2" variant="cardTitle">
              {title}
            </Text>
            {description && (
              <Text variant="caption" tone="muted">
                {description}
              </Text>
            )}
          </TextGroup>
          {action}
        </div>
      )}
      {children}
    </article>
  );
}
